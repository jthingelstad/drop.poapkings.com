import { describe, expect, it, vi } from "vitest";
import {
  deleteButtondownSubscriber,
  enrollButtondownSubscriber,
} from "../src/buttondown.js";

const config = {
  apiKey: "buttondown-key",
  newsletterId: "news_2d3heqk1789vyatbxaeg4b2c91",
};

describe("Buttondown subscriber lifecycle", () => {
  it("does nothing when the integration is not configured", async () => {
    const fetcher = vi.fn();

    await enrollButtondownSubscriber({}, "player@example.com", fetcher);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("enrolls a redeemed address without a second confirmation email", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 201 });

    await enrollButtondownSubscriber(config, "player@example.com", fetcher);

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
      metadata: { source: "elixir-drop-magic-link" },
    });
  });

  it("treats an existing subscriber as a no-op without overwriting their state", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await enrollButtondownSubscriber(config, "player@example.com", fetcher);

    expect(warning).not.toHaveBeenCalled();
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
