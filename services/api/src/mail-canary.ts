import { emailFrom, emailFromName, required } from "./config.js";
import { sendMailCanary } from "./jmap.js";

// The canary deliberately reads only its own four variables (it runs on a
// Lambda without the API's environment). It sends from exactly the same
// elixir@ address as magic links but targets the monitored drop@ administrative
// mailbox by default; sender and recipient must remain independent.
export async function mailCanaryHandler(): Promise<{ submittedAt: string }> {
  const submittedAt = new Date().toISOString();
  const fromEmail = emailFrom();
  await sendMailCanary({
    token: required("FASTMAIL_JMAP_TOKEN"),
    fromEmail,
    fromName: emailFromName(),
    to: process.env.ELIXIR_DROP_CANARY_EMAIL?.trim() || "drop@poapkings.com",
    observedAt: new Date(submittedAt),
  });
  console.info("Mail canary submitted", { submittedAt });
  return { submittedAt };
}
