import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "../src/signing.js";

describe("signed tokens", () => {
  it("round trips valid claims and rejects tampering", () => {
    const token = signToken(
      { type: "session", sub: "player", iat: 100, exp: 200 },
      "secret",
    );
    expect(verifyToken(token, "session", "secret", 150).sub).toBe("player");
    expect(() => verifyToken(`${token}x`, "session", "secret", 150)).toThrow(
      "Invalid token",
    );
  });

  it("rejects expired tokens and wrong claim types", () => {
    const token = signToken(
      { type: "session", sub: "player", iat: 100, exp: 200 },
      "secret",
    );
    expect(() => verifyToken(token, "session", "secret", 200)).toThrow(
      "Expired",
    );
    expect(() => verifyToken(token, "run", "secret", 150)).toThrow("Expired");
  });

  it("binds generated name choices to a favorite card", () => {
    const token = signToken(
      {
        type: "names",
        sub: "player",
        favoriteCardId: 26000000,
        names: ["Knight Main"],
        iat: 100,
        exp: 200,
      },
      "secret",
    );
    const claims = verifyToken(token, "names", "secret", 150);
    expect(claims.favoriteCardId).toBe(26000000);
    expect(claims.names).toEqual(["Knight Main"]);
  });
});
