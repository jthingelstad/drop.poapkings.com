import rawCards from "@elixir-drop/game-data/cards.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FavoriteCard } from "../src/cards.js";
import { CARD_NAME_FLAVORS } from "../src/name-flavors.js";
import {
  allNameCandidatesForCard,
  candidateSlateForCard,
  generateNameOptions,
  isSafeGeneratedName,
  nameSelectionPrompt,
  parseModelCandidateIds,
  selectCandidateNames,
} from "../src/names.js";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    send = send;
  },
  ConverseCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

interface CardData {
  cards: FavoriteCard[];
}

const cards = (rawCards as CardData).cards.map(({ id, name }) => ({
  id,
  name,
}));

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("safe player-name recipes", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("has a reviewed flavor profile for exactly every canonical card", () => {
    expect(
      Object.keys(CARD_NAME_FLAVORS)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(cards.map((card) => card.id).sort((a, b) => a - b));
  });

  it("exhaustively renders only unique safe names in all five humor lanes", () => {
    for (const card of cards) {
      const candidates = allNameCandidatesForCard(card);
      expect(new Set(candidates.map((candidate) => candidate.lane))).toEqual(
        new Set(["nickname", "battle", "character", "arena", "wildcard"]),
      );
      expect(candidates.length).toBeGreaterThanOrEqual(80);
      expect(
        new Set(candidates.map((candidate) => candidate.name.toLowerCase()))
          .size,
      ).toBe(candidates.length);
      expect(
        candidates.every((candidate) => isSafeGeneratedName(candidate.name)),
      ).toBe(true);
    }
  });

  it("deals a fresh bounded slate with equal representation per lane", () => {
    const card = cards.find((candidate) => candidate.name === "Skeleton Army")!;
    const first = candidateSlateForCard(card, 8, seededRandom(1));
    const second = candidateSlateForCard(card, 8, seededRandom(2));

    expect(first).toHaveLength(40);
    for (const lane of [
      "nickname",
      "battle",
      "character",
      "arena",
      "wildcard",
    ]) {
      expect(first.filter((candidate) => candidate.lane === lane)).toHaveLength(
        8,
      );
    }
    expect(first.map((candidate) => candidate.name)).not.toEqual(
      second.map((candidate) => candidate.name),
    );
  });

  it("accepts only candidate ids from model JSON and never model-authored names", () => {
    expect(
      parseModelCandidateIds(
        '```json\n{"ids":["c4",42,"invented"],"names":["Unsafe Free Text"]}\n```',
      ),
    ).toEqual(["c4", "invented"]);
    expect(parseModelCandidateIds('{"names":["Skarmy Picnic"]}')).toEqual([]);
    expect(parseModelCandidateIds("not json")).toEqual([]);
  });

  it("keeps at most one model choice per lane and safely fills missing lanes", () => {
    const card = cards.find(
      (candidate) => candidate.name === "Mini P.E.K.K.A",
    )!;
    const slate = candidateSlateForCard(card, 3, seededRandom(7));
    const twoNicknameIds = slate
      .filter((candidate) => candidate.lane === "nickname")
      .slice(0, 2)
      .map((candidate) => candidate.id);
    const names = selectCandidateNames(
      slate,
      [...twoNicknameIds, "invented", "c999"],
      5,
    );

    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
    expect(names.every(isSafeGeneratedName)).toBe(true);
    expect(
      new Set(
        names.map(
          (name) => slate.find((candidate) => candidate.name === name)?.lane,
        ),
      ).size,
    ).toBe(5);
  });

  it("asks Haiku to edit a supplied slate without creating display text", () => {
    const card = cards.find((candidate) => candidate.name === "Hog Rider")!;
    const slate = candidateSlateForCard(card, 2, seededRandom(9));
    const prompt = nameSelectionPrompt(card, slate, 5);
    const first = slate[0]!;

    expect(prompt).toContain('favorite card is "Hog Rider"');
    expect(prompt).toContain(
      "Never invent, rewrite, combine, or return visible name text",
    );
    expect(prompt).toContain(`${first.id} = ${first.name}`);
    expect(prompt).toContain('{"ids":["c1","c2"]}');
  });

  it("maps a model response back to the safe slate and ignores its free text", async () => {
    send.mockResolvedValue({
      output: {
        message: {
          content: [
            {
              text: '{"ids":["c1","c9","c17","c25","c33"],"names":["Unsafe Free Text"]}',
            },
          ],
        },
      },
    });
    const card = cards.find((candidate) => candidate.name === "Skeleton Army")!;

    const names = await generateNameOptions("test-model", card);

    expect(names).toHaveLength(5);
    expect(names).not.toContain("Unsafe Free Text");
    expect(names.every(isSafeGeneratedName)).toBe(true);
    const command = send.mock.calls[0]![0] as {
      input: { inferenceConfig: { maxTokens: number } };
    };
    expect(command.input.inferenceConfig.maxTokens).toBe(160);
  });

  it("returns a complete safe set when model selection fails", async () => {
    send.mockRejectedValue(new Error("model unavailable"));
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const card = cards.find((candidate) => candidate.name === "The Log")!;

    const names = await generateNameOptions("test-model", card);

    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
    expect(names.every(isSafeGeneratedName)).toBe(true);
    expect(warning).toHaveBeenCalledWith(
      "Name selection model failed; using safe recipe fallback",
      { error: "Error" },
    );
    warning.mockRestore();
  });

  it("fails closed when a canonical card has no reviewed flavor", () => {
    expect(() =>
      allNameCandidatesForCard({ id: 999_999_999, name: "New Card" }),
    ).toThrow("Missing reviewed player-name flavor");
  });
});
