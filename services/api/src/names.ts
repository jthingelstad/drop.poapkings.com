import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

const CARD_NICKNAMES: Readonly<Record<string, readonly string[]>> = {
  "Archer Queen": ["AQ"],
  "Baby Dragon": ["Baby D"],
  "Electro Dragon": ["E-Drag"],
  "Electro Wizard": ["E-Wiz"],
  "Elite Barbarians": ["E-Barbs"],
  "Goblin Barrel": ["Gob Barrel"],
  "Golden Knight": ["GK"],
  "Inferno Dragon": ["Inferno D"],
  "Little Prince": ["LP"],
  Lumberjack: ["Lumber"],
  "Mega Knight": ["MK"],
  "Mighty Miner": ["MM"],
  "Mini P.E.K.K.A": ["Mini P", "Pancake Bot"],
  "P.E.K.K.A": ["Pekka"],
  "Royal Giant": ["RG"],
  "Royal Hogs": ["Piggies"],
  "Skeleton Army": ["Skarmy"],
  "Skeleton Barrel": ["Skelly Barrel"],
  "Skeleton King": ["SK"],
  "The Log": ["Log"],
  "Three Musketeers": ["3M"],
  "Wall Breakers": ["Wallies"],
};

const DISALLOWED_WORDS = new Set([
  "admin",
  "administrator",
  "moderator",
  "official",
  "staff",
  "support",
  "supercell",
  "discord",
  "instagram",
  "snapchat",
  "tiktok",
  "twitch",
  "twitter",
  "youtube",
  "damn",
  "hell",
  "crap",
  "ass",
  "bastard",
  "bitch",
  "dick",
  "fuck",
  "piss",
  "shit",
  "slut",
  "whore",
]);

const DISALLOWED_COMPACT_FRAGMENTS = [
  "fuck",
  "shit",
  "bitch",
  "dick",
  "pussy",
  "cunt",
  "nigger",
  "faggot",
  "kike",
  "chink",
  "spic",
] as const;

const client = new BedrockRuntimeClient({});

function safetyFold(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("0", "o")
    .replaceAll("1", "i")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t");
}

export function isSafeGeneratedName(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim()) return false;
  if (value.length < 2 || value.length > 32) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9 .'-]*$/.test(value)) return false;
  if (/ {2}|--|''|[-']$/.test(value)) return false;

  const folded = safetyFold(value);
  const words = folded.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || words.length > 5) return false;
  if (words.some((word) => DISALLOWED_WORDS.has(word))) return false;

  const compact = words.join("");
  if (DISALLOWED_COMPACT_FRAGMENTS.some((term) => compact.includes(term)))
    return false;
  return !/(?:https?|www|dotcom|gmail|outlook|yahoo)/.test(compact);
}

function nicknameHints(cardName: string): readonly string[] {
  return CARD_NICKNAMES[cardName] ?? [];
}

export function fallbackNamesForCard(cardName: string): string[] {
  const root = nicknameHints(cardName)[0] || cardName;
  return [
    root,
    `${root} Energy`,
    `Pocket ${root}`,
    `${root} Parade`,
    `${root} Quest`,
    `${root} Snack Club`,
  ].filter(isSafeGeneratedName);
}

export function parseModelNames(text: string): string[] {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { names?: unknown };
    if (!Array.isArray(parsed.names)) return [];
    const names = new Map<string, string>();
    for (const name of parsed.names) {
      if (!isSafeGeneratedName(name)) continue;
      const key = name.toLowerCase();
      if (!names.has(key)) names.set(key, name);
    }
    return [...names.values()];
  } catch {
    return [];
  }
}

function generationPrompt(cardName: string, count: number): string {
  const hints = nicknameHints(cardName);
  return `Create ${count} distinct, playful public player names inspired by the Clash Royale card "${cardName}".

The name does NOT need to contain the official card title. Draw from the card's community nickname or shorthand, character, artwork, mechanic, personality, sound, or a funny association. Known nickname hints for this card: ${hints.length ? hints.join(", ") : "none supplied; use your Clash Royale knowledge when confident"}.

Good style examples (do not copy unless they fit this card): Skarmy Picnic, Bone Parade, Mini P Pancakes, Pancake Patrol, E-Wiz Fizz, Pocket Pekka, Toasty Wings. Favor memorable wordplay over generic labels like Pro, Main, Legend, Master, or Fan.

Every option must be family-friendly for an all-ages game community, 2-32 characters, 1-5 words, and use only ASCII letters, numbers, spaces, apostrophes, hyphens, or periods. No profanity, slurs, suggestive language, insults, personal information, handles, URLs, political or religious references, or claims to be staff, official, Supercell, or support.

Return only JSON shaped {"names":["Skarmy Picnic"]}.`;
}

export async function generateNameOptions(
  modelId: string,
  cardName: string,
  count = 5,
): Promise<string[]> {
  let generated: string[] = [];
  try {
    const response = await client.send(
      new ConverseCommand({
        modelId,
        inferenceConfig: { maxTokens: 400, temperature: 1 },
        system: [
          {
            text: "You invent concise, clever, family-friendly player names for a Clash Royale practice game. Follow the requested JSON schema exactly and never include unsafe or identifying content.",
          },
        ],
        messages: [
          {
            role: "user",
            content: [{ text: generationPrompt(cardName, count) }],
          },
        ],
      }),
    );
    const text =
      response.output?.message?.content
        ?.map((item) => ("text" in item ? item.text : ""))
        .join("") ?? "";
    generated = parseModelNames(text);
  } catch (error) {
    console.warn("Name generation model failed; using favorite-card fallback", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }

  const names = new Map(generated.map((name) => [name.toLowerCase(), name]));
  for (const fallback of fallbackNamesForCard(cardName)) {
    if (names.size >= count) break;
    const key = fallback.toLowerCase();
    if (!names.has(key)) names.set(key, fallback);
  }
  return [...names.values()].slice(0, count);
}
