import { describe, expect, it } from "vitest";
import { tidyGameName } from "../src/elixir-identity.js";
import { renderPublishedSharePage } from "../src/published-page.js";
import { escapeDisplayName } from "../src/season-posts.js";

// Since 2026-11-14 a signed-in player's name is their Clash Royale game name,
// which the game lets a person type almost anything into. These names are
// invented; each is a way a name could try to become markup.
const HOSTILE = [
  '<img src=x onerror="alert(1)">',
  "</strong><script>alert(1)</script>",
  "\" onmouseover='x()' data-x=\"",
  "King & <b>Queen</b>",
  "[click](javascript:alert(1))",
];

describe("hostile game names at Drop's server-rendered outputs", () => {
  function page(name: string) {
    return renderPublishedSharePage({
      title: `${name} scored 12 in Surge | Elixir Drop`,
      description: `${name} put up 12 in Surge. Can you beat it?`,
      canonical: "https://drop.test/s/abc",
      image: "https://drop.test/s/abc.png",
      imageAlt: `${name}'s Surge result`,
      challenge: "https://drop.test/surge",
      cta: "Play Surge",
      pitch: `${name} scored 12.`,
      profile: "https://drop.test/p/abc",
      playerName: name,
      scriptSrc: "/assets/share.js",
      bodyData: { player: name },
    });
  }
  const count = (html: string, pattern: RegExp) =>
    html.match(pattern)?.length ?? 0;
  it.each(HOSTILE)("a published share page shows %s as text", (raw) => {
    const benign = page("Sample Player");
    const html = page(tidyGameName(raw)!);
    // The name adds no element, no attribute and no quote: every tag and
    // quote in the page is the page's own.
    expect(count(html, /</g)).toBe(count(benign, /</g));
    expect(count(html, /"/g)).toBe(count(benign, /"/g));
    expect(count(html, /'/g)).toBe(count(benign, /'/g));
    if (raw.includes("<")) expect(html).toContain("&lt;");
    if (raw.includes('"')) expect(html).toContain("&quot;");
  });

  it.each(HOSTILE)("a season post carries %s as inert Markdown text", (raw) => {
    const escaped = escapeDisplayName(tidyGameName(raw)!);
    expect(escaped).not.toMatch(/[<>]/);
    expect(escaped).not.toMatch(/(^|[^\\])[[\]()]/);
  });
});
