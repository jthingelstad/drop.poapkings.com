import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

const NAME_MODIFIERS = [
  "Ace",
  "Captain",
  "Champ",
  "Crew",
  "Fan",
  "Friend",
  "Hero",
  "Legend",
  "Main",
  "Master",
  "Pro",
  "Squad",
  "Star",
  "Team",
] as const;

const client = new BedrockRuntimeClient({});

export function isSafeFavoriteCardName(
  value: unknown,
  cardName: string,
): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  if (value === cardName) return true;
  return NAME_MODIFIERS.some(
    (modifier) =>
      value === `${cardName} ${modifier}` ||
      value === `${modifier} ${cardName}`,
  );
}

export function fallbackNamesForCard(cardName: string): string[] {
  return [
    cardName,
    `${cardName} Main`,
    `${cardName} Ace`,
    `Team ${cardName}`,
    `${cardName} Legend`,
    `${cardName} Fan`,
  ];
}

function parseModelNames(text: string, cardName: string): string[] {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { names?: unknown };
    return Array.isArray(parsed.names)
      ? parsed.names.filter((name) => isSafeFavoriteCardName(name, cardName))
      : [];
  } catch {
    return [];
  }
}

export async function generateNameOptions(
  modelId: string,
  cardName: string,
  count = 5,
): Promise<string[]> {
  const modifiers = NAME_MODIFIERS.join(", ");
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
                text: `Create ${count} playful public player names based only on the Clash Royale card title "${cardName}". Every name must contain that complete card title exactly as written, either alone or with exactly one modifier before or after it. The only allowed modifiers are: ${modifiers}. Do not add any other words or punctuation. Return only JSON shaped {"names":["${cardName} Main"]}.`,
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
    generated = parseModelNames(text, cardName);
  } catch (error) {
    console.warn("Name generation model failed; using favorite-card fallback", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }

  const names = new Set(generated);
  for (const fallback of fallbackNamesForCard(cardName)) {
    if (names.size >= count) break;
    names.add(fallback);
  }
  return [...names].slice(0, count);
}
