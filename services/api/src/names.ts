import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { FavoriteCard } from "./cards.js";
import { CARD_NAME_FLAVORS } from "./name-flavors.js";

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
  "noob",
  "midladder",
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
  "spic",
  "slut",
  "whore",
]);

const DISALLOWED_COMPACT_FRAGMENTS = [
  "paytowin",
  "p2w",
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
] as const;

const NAME_LANES = [
  "nickname",
  "battle",
  "character",
  "arena",
  "wildcard",
] as const;

export type NameLane = (typeof NAME_LANES)[number];

export interface NameCandidate {
  id: string;
  lane: NameLane;
  name: string;
}

const NICKNAME_SCENES = [
  "Picnic",
  "Snack Break",
  "Dance Break",
  "Brunch Club",
  "Rush Hour",
  "Day Off",
  "Pajama Party",
  "Bake Sale",
  "Road Trip",
  "Lunch Club",
] as const;

const BATTLE_ENDINGS = [
  "Patrol",
  "Parade",
  "Stampede",
  "Shuffle",
  "Charge",
  "Brigade",
  "Blitz",
  "Bounce",
  "Rumble",
  "Rally",
  "Rush",
  "Crew",
] as const;

const CHARACTER_MODIFIERS = [
  "Pocket",
  "Turbo",
  "Sneaky",
  "Toasty",
  "Tiny",
  "Midnight",
  "Cozy",
  "Bouncy",
  "Speedy",
  "Wobbly",
  "Sparkly",
  "Sleepy",
] as const;

const ARENA_OPENERS = [
  "Bridge",
  "Crown",
  "Elixir",
  "Overtime",
  "Tower",
  "Arena",
  "Deck",
  "Double Elixir",
] as const;

const WILDCARD_SCENES = [
  "Picnic",
  "Snack Club",
  "Tea Time",
  "Disco",
  "Day Off",
  "Pancake Run",
  "Lunch Break",
  "Road Trip",
  "Party",
  "Brunch",
] as const;

const client = new BedrockRuntimeClient({
  maxAttempts: 5,
  retryMode: "adaptive",
});

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

function flavorFor(card: FavoriteCard) {
  const flavor = CARD_NAME_FLAVORS[card.id];
  if (!flavor)
    throw new Error(`Missing reviewed player-name flavor for card ${card.id}`);
  return flavor;
}

export function allNameCandidatesForCard(card: FavoriteCard): NameCandidate[] {
  const flavor = flavorFor(card);
  const anchors = flavor.nicknames?.length ? flavor.nicknames : [card.name];
  const candidates = new Map<string, Omit<NameCandidate, "id">>();

  function add(lane: NameLane, name: string) {
    if (!isSafeGeneratedName(name)) return;
    const key = name.toLowerCase();
    if (!candidates.has(key)) candidates.set(key, { lane, name });
  }

  for (const anchor of anchors)
    for (const scene of NICKNAME_SCENES) add("nickname", `${anchor} ${scene}`);
  for (const motif of flavor.motifs)
    for (const ending of BATTLE_ENDINGS) add("battle", `${motif} ${ending}`);
  for (const modifier of CHARACTER_MODIFIERS)
    for (const motif of flavor.motifs) add("character", `${modifier} ${motif}`);
  for (const opener of ARENA_OPENERS)
    for (const motif of flavor.motifs) add("arena", `${opener} ${motif}`);
  for (const motif of flavor.motifs)
    for (const scene of WILDCARD_SCENES) add("wildcard", `${motif} ${scene}`);

  return [...candidates.values()].map((candidate, index) => ({
    id: `r${index + 1}`,
    ...candidate,
  }));
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index]!;
    copy[index] = copy[swap]!;
    copy[swap] = current;
  }
  return copy;
}

export function candidateSlateForCard(
  card: FavoriteCard,
  perLane = 8,
  random: () => number = Math.random,
): NameCandidate[] {
  const all = allNameCandidatesForCard(card);
  const slate = NAME_LANES.flatMap((lane) =>
    shuffled(
      all.filter((candidate) => candidate.lane === lane),
      random,
    ).slice(0, perLane),
  );
  return slate.map((candidate, index) => ({
    ...candidate,
    id: `c${index + 1}`,
  }));
}

export function parseModelCandidateIds(text: string): string[] {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { ids?: unknown };
    if (!Array.isArray(parsed.ids)) return [];
    return parsed.ids.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function selectCandidateNames(
  candidates: readonly NameCandidate[],
  requestedIds: readonly string[],
  count: number,
): string[] {
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const selected: NameCandidate[] = [];
  const usedNames = new Set<string>();
  const usedLanes = new Set<NameLane>();

  function add(candidate: NameCandidate | undefined, requireNewLane: boolean) {
    if (!candidate || selected.length >= count) return;
    const key = candidate.name.toLowerCase();
    if (usedNames.has(key) || (requireNewLane && usedLanes.has(candidate.lane)))
      return;
    selected.push(candidate);
    usedNames.add(key);
    usedLanes.add(candidate.lane);
  }

  for (const id of requestedIds) add(byId.get(id), true);
  for (const lane of NAME_LANES)
    add(
      candidates.find((candidate) => candidate.lane === lane),
      true,
    );
  for (const candidate of candidates) add(candidate, false);

  return selected.map((candidate) => candidate.name);
}

export function nameSelectionPrompt(
  card: FavoriteCard,
  candidates: readonly NameCandidate[],
  count: number,
): string {
  const choices = NAME_LANES.map((lane) => {
    const laneChoices = candidates
      .filter((candidate) => candidate.lane === lane)
      .map((candidate) => `${candidate.id} = ${candidate.name}`)
      .join("; ");
    return `${lane}: ${laneChoices}`;
  }).join("\n");

  return `Choose ${count} playful public player names for a fan-made Clash Royale practice game. The favorite card is "${card.name}".

The server has already assembled and safety-checked every candidate below. Act as a comedy editor: pick the choices with the strongest card connection, rhythm, surprise, and friendly arena energy. They should feel like community inside jokes, not generic gamer tags or literal descriptions.

Choose at most one from each lane. Avoid repeated roots, endings, joke structures, and near-duplicates. Never invent, rewrite, combine, or return visible name text.

${choices}

Return only JSON shaped {"ids":["c1","c2"]}. Use candidate IDs exactly as supplied.`;
}

export async function generateNameOptions(
  modelId: string,
  card: FavoriteCard,
  count = 5,
): Promise<string[]> {
  const candidates = candidateSlateForCard(card);
  let requestedIds: string[] = [];
  try {
    const response = await client.send(
      new ConverseCommand({
        modelId,
        inferenceConfig: { maxTokens: 160, temperature: 0.9 },
        system: [
          {
            text: "You are the comedy editor for a cheerful Clash Royale practice game. Select only supplied candidate IDs. Never create or repeat visible name text.",
          },
        ],
        messages: [
          {
            role: "user",
            content: [{ text: nameSelectionPrompt(card, candidates, count) }],
          },
        ],
      }),
    );
    const text =
      response.output?.message?.content
        ?.map((item) => ("text" in item ? item.text : ""))
        .join("") ?? "";
    requestedIds = parseModelCandidateIds(text);
  } catch (error) {
    console.warn("Name selection model failed; using safe recipe fallback", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }

  return selectCandidateNames(candidates, requestedIds, count);
}
