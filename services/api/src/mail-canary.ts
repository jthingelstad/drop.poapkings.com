import { sendMailCanary } from "./jmap.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function mailCanaryHandler(): Promise<{ submittedAt: string }> {
  const submittedAt = new Date().toISOString();
  const fromEmail =
    process.env.ELIXIR_DROP_EMAIL_FROM?.trim() || "elixir@poapkings.com";
  await sendMailCanary({
    token: required("FASTMAIL_JMAP_TOKEN"),
    fromEmail,
    fromName: process.env.ELIXIR_DROP_EMAIL_FROM_NAME?.trim() || "Elixir Drop",
    to: process.env.ELIXIR_DROP_CANARY_EMAIL?.trim() || fromEmail,
    observedAt: new Date(submittedAt),
  });
  console.info("Mail canary submitted", { submittedAt });
  return { submittedAt };
}
