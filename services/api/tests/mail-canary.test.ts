import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMailCanary = vi.hoisted(() => vi.fn());

vi.mock("../src/jmap.js", () => ({ sendMailCanary }));

import { mailCanaryHandler } from "../src/mail-canary.js";

describe("mail delivery canary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FASTMAIL_JMAP_TOKEN = "jmap-token";
    process.env.ELIXIR_DROP_EMAIL_FROM = "elixir@poapkings.com";
    process.env.ELIXIR_DROP_EMAIL_FROM_NAME = "Elixir Drop";
    process.env.ELIXIR_DROP_CANARY_EMAIL = "canary@poapkings.com";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("submits through the same JMAP path as magic links", async () => {
    sendMailCanary.mockResolvedValue(undefined);

    const result = await mailCanaryHandler();

    expect(sendMailCanary).toHaveBeenCalledWith({
      token: "jmap-token",
      fromEmail: "elixir@poapkings.com",
      fromName: "Elixir Drop",
      to: "canary@poapkings.com",
      observedAt: expect.any(Date),
    });
    expect(Date.parse(result.submittedAt)).not.toBeNaN();
  });

  it("fails the Lambda invocation when JMAP submission fails", async () => {
    sendMailCanary.mockRejectedValue(new Error("JMAP unavailable"));

    await expect(mailCanaryHandler()).rejects.toThrow("JMAP unavailable");
  });
});
