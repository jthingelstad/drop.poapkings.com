import { describe, expect, it } from "vitest";
import {
  magicLinkEmailHtml,
  magicLinkEmailSubject,
  magicLinkEmailText,
  pickSentMailbox,
} from "../src/jmap.js";

describe("sent mailbox selection", () => {
  // The Fastmail account is shared by several agents. Only the top-level Sent
  // carries the JMAP "sent" role; each agent has a plain named child under it.
  const mailboxes = [
    { id: "sent-root", name: "Sent", parentId: null, role: "sent" },
    { id: "drafts", name: "Drafts", parentId: null, role: "drafts" },
    { id: "elixir-sent", name: "Elixir-Sent", parentId: "sent-root" },
    { id: "thingy-sent", name: "Thingy-Sent", parentId: "sent-root" },
  ];

  it("files into Drop's own child of Sent, not the shared Sent", () => {
    expect(pickSentMailbox(mailboxes, "sent-root", "Elixir-Sent")?.id).toBe(
      "elixir-sent",
    );
  });

  it("does not pick another agent's folder", () => {
    expect(pickSentMailbox(mailboxes, "sent-root", "Elixir-Sent")?.id).not.toBe(
      "thingy-sent",
    );
  });

  it("falls back to the shared Sent rather than failing to send", () => {
    expect(pickSentMailbox(mailboxes, "sent-root", "Missing-Sent")?.id).toBe(
      "sent-root",
    );
  });

  it("ignores a same-named folder under a different parent", () => {
    const decoys = [
      ...mailboxes,
      { id: "archive-root", name: "Archive", parentId: null, role: "archive" },
      { id: "decoy", name: "Elixir-Sent", parentId: "archive-root" },
    ];
    expect(pickSentMailbox(decoys, "sent-root", "Elixir-Sent")?.id).toBe(
      "elixir-sent",
    );
  });
});

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

    expect(html).toContain("Ready to drop some elixir?");
    expect(html).toContain("Let's drop!");
    expect(html).toContain(
      "https://drop.poapkings.com/assets/icon/drop-icon-512.png",
    );
    expect(html).toContain("Button being stubborn?");
    expect(html).toContain("&amp;unsafe=&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
