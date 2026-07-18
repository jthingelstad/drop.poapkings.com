import { describe, expect, it } from "vitest";
import {
  magicLinkEmailHtml,
  magicLinkEmailSubject,
  magicLinkEmailText,
} from "../src/jmap.js";

describe("magic-link email", () => {
  const magicLink =
    "https://drop.poapkings.com/#/auth?token=abc123&returnTo=%2Fsurge";

  it("provides a useful plain-text fallback", () => {
    const text = magicLinkEmailText({ magicLink, expiresMinutes: 15 });

    expect(magicLinkEmailSubject()).toBe("Your Elixir Drop sign-in link");
    expect(text).toContain("Elixir Drop is ready.");
    expect(text).toContain(magicLink);
    expect(text).toContain("expires in 15 minutes");
    expect(text).toContain("can only be used once");
    expect(text).toContain("seasonal leaderboards");
  });

  it("renders a branded, escaped HTML email with a visible fallback link", () => {
    const html = magicLinkEmailHtml({
      magicLink: `${magicLink}&unsafe=<script>`,
      expiresMinutes: 15,
    });

    expect(html).toContain("Ready to Drop?");
    expect(html).toContain("Sign in to Elixir Drop");
    expect(html).toContain("https://drop.poapkings.com/assets/elixir-hype.png");
    expect(html).toContain("If the button does not work");
    expect(html).toContain("&amp;unsafe=&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
