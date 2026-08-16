import { describe, expect, it, vi } from "vitest";
import {
  buttondownPlayerMetadata,
  deleteButtondownSubscriber,
  enrollButtondownSubscriber,
  updateButtondownSubscriberMetadata,
} from "../src/buttondown.js";

const config = {
  apiKey: "buttondown-key",
  newsletterId: "news_2d3heqk1789vyatbxaeg4b2c91",
};
const metadata = {
  playerTag: "#2PYQ0",
  clanTag: "#J2RGCRVG",
  totalGames: 42,
};

describe("Buttondown subscriber lifecycle", () => {
  it("does nothing when the integration is not configured", async () => {
    const fetcher = vi.fn();

    await Promise.all([
      enrollButtondownSubscriber({}, "player@example.com", metadata, fetcher),
      updateButtondownSubscriberMetadata(
        {},
        "player@example.com",
        metadata,
        fetcher,
      ),
    ]);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("enrolls a redeemed address without a second confirmation email", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 201 });

    await enrollButtondownSubscriber(
      config,
      "player@example.com",
      metadata,
      fetcher,
    );

    const [url, request] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.buttondown.com/v1/subscribers");
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      Authorization: "Token buttondown-key",
      "Buttondown-Context": config.newsletterId,
    });
    expect(request.headers).not.toHaveProperty(
      "X-Buttondown-Collision-Behavior",
    );
    expect(typeof request.body).toBe("string");
    expect(JSON.parse(request.body as string)).toEqual({
      email_address: "player@example.com",
      type: "regular",
      metadata: {
        source: "elixir-drop-magic-link",
        player_tag: "#2PYQ0",
        clan_tag: "#J2RGCRVG",
        total_games: 42,
      },
    });
  });

  it("updates an existing subscriber's metadata without overwriting their state", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await enrollButtondownSubscriber(
      config,
      "player@example.com",
      metadata,
      fetcher,
    );

    expect(warning).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, request] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(
      "https://api.buttondown.com/v1/subscribers/player%40example.com",
    );
    expect(request.method).toBe("PATCH");
    expect(JSON.parse(request.body as string)).toEqual({
      metadata: {
        source: "elixir-drop-magic-link",
        player_tag: "#2PYQ0",
        clan_tag: "#J2RGCRVG",
        total_games: 42,
      },
    });
    expect(JSON.parse(request.body as string)).not.toHaveProperty("type");
  });

  it("clears a known missing clan while preserving unknown clan metadata", async () => {
    expect(
      buttondownPlayerMetadata(
        { playerTag: "#2PYQ0", totalGames: 7 },
        { status: "ready", clan: undefined },
      ),
    ).toEqual({ playerTag: "#2PYQ0", clanTag: null, totalGames: 7 });
    expect(
      buttondownPlayerMetadata(
        { playerTag: "#2PYQ0", totalGames: 8 },
        { status: "pending", clan: undefined },
      ),
    ).toEqual({ playerTag: "#2PYQ0", totalGames: 8 });
    expect(
      buttondownPlayerMetadata(
        { playerTag: "#NEW", totalGames: 8 },
        { status: "pending", clan: undefined },
        true,
      ),
    ).toEqual({ playerTag: "#NEW", clanTag: null, totalGames: 8 });
  });

  it("patches current activity and a known no-clan state by email", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await updateButtondownSubscriberMetadata(
      config,
      "player+drop@example.com",
      { playerTag: "#2PYQ0", clanTag: null, totalGames: 43 },
      fetcher,
    );

    const [url, request] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.buttondown.com/v1/subscribers/player%2Bdrop%40example.com",
    );
    expect(request.method).toBe("PATCH");
    expect(JSON.parse(request.body as string)).toMatchObject({
      metadata: {
        player_tag: "#2PYQ0",
        clan_tag: null,
        total_games: 43,
      },
    });
  });

  it("deletes the matching subscriber with explicit newsletter context", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 204 });

    await deleteButtondownSubscriber(
      config,
      "player+drop@example.com",
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.buttondown.com/v1/subscribers/player%2Bdrop%40example.com",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          "Buttondown-Context": config.newsletterId,
        }),
      }),
    );
  });
});
