import { describe, expect, it } from "vitest";
import {
  buildEvidenceItem,
  deriveCorrelation,
  EVIDENCE_TTL_SECONDS,
} from "../src/referee-evidence.js";
import { SCORING_RULES_VERSION } from "../src/scoring.js";
import type { RunChallenge, RunTranscript } from "../src/types.js";

const PEPPER = "unit-test-pepper";

describe("deriveCorrelation", () => {
  it("hashes the same IP to the same token, a different IP to a different one", () => {
    const a = deriveCorrelation(PEPPER, "203.0.113.7", undefined);
    const again = deriveCorrelation(PEPPER, "203.0.113.7", undefined);
    const other = deriveCorrelation(PEPPER, "198.51.100.7", undefined);

    expect(a.ipHash).toBeDefined();
    expect(again.ipHash).toBe(a.ipHash);
    expect(other.ipHash).not.toBe(a.ipHash);
  });

  it("groups two hosts on one /24 by ipSubnetHash while keeping ipHash distinct", () => {
    const a = deriveCorrelation(PEPPER, "203.0.113.7", undefined);
    const b = deriveCorrelation(PEPPER, "203.0.113.200", undefined);

    // Same network, different address: subnet hash matches, exact hash does not.
    expect(a.ipSubnetHash).toBe(b.ipSubnetHash);
    expect(a.ipHash).not.toBe(b.ipHash);
  });

  it("never leaks the raw IP or user-agent into the output", () => {
    const ip = "203.0.113.7";
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36";
    const correlation = deriveCorrelation(PEPPER, ip, ua);
    const serialized = JSON.stringify(correlation);

    expect(serialized).not.toContain(ip);
    expect(serialized).not.toContain(ua);
    expect(serialized).not.toContain("Mozilla");
    expect(serialized).not.toContain(PEPPER);
    // A coarse family is fine to expose; a full UA string is not.
    expect(correlation.uaFamily).toBe("Chrome/macOS");
  });

  it("depends on the pepper: rotating it changes the hash", () => {
    const a = deriveCorrelation(PEPPER, "203.0.113.7", undefined);
    const rotated = deriveCorrelation(
      "different-pepper",
      "203.0.113.7",
      undefined,
    );
    expect(rotated.ipHash).not.toBe(a.ipHash);
  });

  it("omits ipHash/ipSubnetHash when the IP is missing", () => {
    const correlation = deriveCorrelation(PEPPER, undefined, "vitest");
    expect(correlation.ipHash).toBeUndefined();
    expect(correlation.ipSubnetHash).toBeUndefined();
    expect(correlation.uaHash).toBeDefined();
  });

  it("omits uaHash/uaFamily when the user-agent is missing", () => {
    const correlation = deriveCorrelation(PEPPER, "203.0.113.7", undefined);
    expect(correlation.uaHash).toBeUndefined();
    expect(correlation.uaFamily).toBeUndefined();
  });

  it("normalizes IPv6 case and derives a /64 subnet hash", () => {
    const lower = deriveCorrelation(
      PEPPER,
      "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      undefined,
    );
    const upper = deriveCorrelation(
      PEPPER,
      "2001:0DB8:85A3:0000:0000:8A2E:0370:7334",
      undefined,
    );
    expect(upper.ipHash).toBe(lower.ipHash);
    expect(upper.ipSubnetHash).toBe(lower.ipSubnetHash);
  });

  it("classifies common UA families without an external library", () => {
    expect(
      deriveCorrelation(
        PEPPER,
        undefined,
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1",
      ).uaFamily,
    ).toBe("Safari/iOS");
    expect(
      deriveCorrelation(
        PEPPER,
        undefined,
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
      ).uaFamily,
    ).toBe("Firefox/Windows");
    expect(deriveCorrelation(PEPPER, undefined, "curl/8.0").uaFamily).toBe(
      "Other",
    );
  });
});

describe("buildEvidenceItem", () => {
  const challenge: RunChallenge = { mode: "surge", cardIds: [26000000] };
  const transcript: RunTranscript = {
    answers: [{ cardId: 26000000, guesses: [3], atMs: 1_000 }],
  };
  const base = {
    sub: "player-sub",
    runId: "run-1",
    mode: "surge" as const,
    seasonId: "2026-07",
    runType: "ranked" as const,
    integrityOutcome: "accepted",
    score: 12_345,
    challenge,
    transcript,
    startedAt: "2026-07-18T12:00:00.000Z",
    completedAt: "2026-07-18T12:01:00.000Z",
    wallElapsedMs: 60_000,
    webVersion: "abc123def456",
    startCorrelation: deriveCorrelation(PEPPER, "203.0.113.7", "vitest"),
    completeCorrelation: deriveCorrelation(PEPPER, "203.0.113.7", "vitest"),
    playerTag: "#2PYQ0",
  };

  it("assembles the full referee item with the documented key shape", () => {
    const item = buildEvidenceItem(base);

    expect(item.pk).toBe("PLAYER#player-sub");
    expect(item.sk).toBe("EVIDENCE#2026-07-18T12:01:00.000Z#run-1");
    expect(item.runType).toBe("ranked");
    expect(item.integrityOutcome).toBe("accepted");
    expect(item.challenge).toEqual(challenge);
    expect(item.transcript).toEqual(transcript);
    expect(item.wallElapsedMs).toBe(60_000);
    expect(item.scoringVersion).toEqual({
      rules: SCORING_RULES_VERSION,
      web: "abc123def456",
    });
    expect(item.correlation.complete).toEqual(base.completeCorrelation);
    expect(item.correlation.start).toEqual(base.startCorrelation);
    expect(item.playerTag).toBe("#2PYQ0");
    expect(item.schemaVersion).toBe("1");
  });

  it("stamps a TTL 180 days past completion", () => {
    const item = buildEvidenceItem(base);
    const completedEpoch = Math.floor(
      new Date(base.completedAt).getTime() / 1_000,
    );
    expect(item.expiresAt).toBe(completedEpoch + EVIDENCE_TTL_SECONDS);
  });

  it("carries no email field and keys by sub, not email", () => {
    const item = buildEvidenceItem(base);
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("@");
    expect(item.playerSub).toBe("player-sub");
  });

  it("omits score for a scorer-rejected item with no computed score", () => {
    const item = buildEvidenceItem({
      ...base,
      score: undefined,
      runType: "rejected",
      integrityOutcome: "Answer timing is invalid",
      startCorrelation: undefined,
    });
    expect(item.score).toBeUndefined();
    expect(item.runType).toBe("rejected");
    expect(item.integrityOutcome).toBe("Answer timing is invalid");
    // No start correlation captured -> only complete is present.
    expect(item.correlation.start).toBeUndefined();
    expect(item.correlation.complete).toBeDefined();
  });
});
