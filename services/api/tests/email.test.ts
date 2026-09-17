import type { SESv2Client } from "@aws-sdk/client-sesv2";
import { describe, expect, it } from "vitest";
import {
  magicLinkEmailHtml,
  magicLinkEmailSubject,
  magicLinkEmailText,
  sendMagicLink,
  setSesClient,
} from "../src/email.js";

describe("magic-link email", () => {
  const magicLink =
    "https://drop.poapkings.com/#/auth?token=abc123&returnTo=%2Fsurge";
  const code = "042761";

  it("provides a useful plain-text fallback", () => {
    const text = magicLinkEmailText({ magicLink, code, expiresMinutes: 15 });

    expect(magicLinkEmailSubject(code)).toBe(
      "042761 is your Elixir Drop sign-in code",
    );
    expect(text).toContain("042761 is your Elixir Drop sign-in code.");
    expect(text).toContain("Enter this six-digit code");
    expect(text).toContain(magicLink);
    expect(text).toContain("expire in 15 minutes");
    expect(text).toContain("Either one can be used once");
    expect(text).toContain("seasonal leaderboards");
  });

  it("renders a branded email with a visible code and escaped fallback link", () => {
    const html = magicLinkEmailHtml({
      magicLink: `${magicLink}&unsafe=<script>`,
      code,
      expiresMinutes: 15,
    });

    expect(html).toContain("Ready to drop some elixir?");
    expect(html).toContain("Let's drop!");
    expect(html).toContain(
      "https://drop.poapkings.com/assets/icon/drop-icon-512.png",
    );
    expect(html).toContain("Your sign-in code");
    expect(html).toContain(code);
    expect(html).toContain("Button being stubborn?");
    expect(html).toContain("&amp;unsafe=&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("sending over SES", () => {
  it("sends one multipart message through the configuration set, as the named sender", async () => {
    const sent: unknown[] = [];
    setSesClient({
      send: async (command: { input: unknown }) => {
        sent.push(command.input);
        return { MessageId: "m-1" };
      },
    } as unknown as SESv2Client);
    try {
      await sendMagicLink({
        fromEmail: "elixir@poapkings.com",
        fromName: "Elixir Drop",
        to: "player@example.com",
        magicLink: "https://drop.poapkings.com/#/auth?token=t",
        code: "123456",
        expiresMinutes: 15,
        configurationSet: "elixir-drop",
      });
    } finally {
      setSesClient(undefined);
    }
    expect(sent).toHaveLength(1);
    const input = sent[0] as {
      FromEmailAddress: string;
      Destination: { ToAddresses: string[] };
      ConfigurationSetName: string;
      Content: {
        Simple: {
          Subject: { Data: string };
          Body: { Text: { Data: string }; Html: { Data: string } };
        };
      };
    };
    expect(input.FromEmailAddress).toBe("Elixir Drop <elixir@poapkings.com>");
    expect(input.Destination.ToAddresses).toEqual(["player@example.com"]);
    expect(input.ConfigurationSetName).toBe("elixir-drop");
    expect(input.Content.Simple.Subject.Data).toBe(
      "123456 is your Elixir Drop sign-in code",
    );
    expect(input.Content.Simple.Body.Text.Data).toContain("123456");
    expect(input.Content.Simple.Body.Html.Data).toContain("123456");
  });
});
