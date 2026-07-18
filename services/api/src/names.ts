import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import rawCards from "@elixir-drop/game-data/cards.json";
import { randomInt } from "node:crypto";

interface CardData {
  cards: Array<{ name: string }>;
}

const cardNames = (rawCards as CardData).cards.map((card) => card.name);
const allowedWords = new Set(
  cardNames.flatMap((name) =>
    name
      .split(/[^A-Za-z0-9]+/)
      .filter((word) => word.length > 1)
      .map((word) => word.toLowerCase()),
  ),
);

const client = new BedrockRuntimeClient({});

function normalizedWords(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function isSafeCardName(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 3 || value.length > 32)
    return false;
  const words = normalizedWords(value);
  return (
    words.length >= 1 &&
    words.length <= 3 &&
    words.every((word) => allowedWords.has(word))
  );
}

function fallbackNames(count: number): string[] {
  const choices = new Set<string>();
  while (choices.size < count) {
    const first = cardNames[randomInt(cardNames.length)]!;
    const second = cardNames[randomInt(cardNames.length)]!;
    const firstWord = first.split(" ")[0]!;
    const secondWord = second.split(" ").at(-1)!;
    const choice = `${firstWord} ${secondWord}`;
    if (isSafeCardName(choice)) choices.add(choice);
  }
  return [...choices];
}

function parseModelNames(text: string): string[] {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { names?: unknown };
    return Array.isArray(parsed.names)
      ? parsed.names.filter(isSafeCardName)
      : [];
  } catch {
    return [];
  }
}

export async function generateNameOptions(
  modelId: string,
  count = 5,
): Promise<string[]> {
  const allowed = [...allowedWords].sort().join(", ");
  let generated: string[] = [];
  try {
    const response = await client.send(
      new ConverseCommand({
        modelId,
        inferenceConfig: { maxTokens: 250, temperature: 0.9 },
        messages: [
          {
            role: "user",
            content: [
              {
                text: `Create ${count} playful public player names for a Clash Royale game site. Each name must be 1 to 3 words and every word must come from this exact allowlist: ${allowed}. Do not use punctuation or any other words. Return only JSON shaped {"names":["Name One"]}.`,
              },
            ],
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
    console.warn(
      "Name generation model failed; using validated card-title fallback",
      {
        error: error instanceof Error ? error.name : "unknown",
      },
    );
  }

  const names = new Set(generated);
  for (const fallback of fallbackNames(count * 2)) {
    if (names.size >= count) break;
    names.add(fallback);
  }
  return [...names].slice(0, count);
}
