const SESSION_URL = "https://api.fastmail.com/jmap/session";
const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SUBMISSION = "urn:ietf:params:jmap:submission";

type JsonObject = Record<string, unknown>;
type MethodResponse = [string, JsonObject, string];

interface JmapSession extends JsonObject {
  apiUrl?: string;
  primaryAccounts?: Record<string, string>;
}

interface SendContext {
  apiUrl: string;
  mailAccountId: string;
  submissionAccountId: string;
  identityId: string;
  draftsId: string;
  sentId: string;
}

interface SendMagicLinkInput {
  token: string;
  fromEmail: string;
  fromName: string;
  to: string;
  magicLink: string;
  expiresMinutes: number;
}

interface SendMailCanaryInput {
  token: string;
  fromEmail: string;
  fromName: string;
  to: string;
  observedAt?: Date;
}

interface SendEmailInput {
  token: string;
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface MagicLinkEmailInput {
  magicLink: string;
  expiresMinutes: number;
  imageUrl?: string;
}

async function jmapFetch<T>(
  url: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!response.ok) throw new Error(`JMAP HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function call(
  apiUrl: string,
  token: string,
  methodCalls: unknown[],
): Promise<MethodResponse[]> {
  const response = await jmapFetch<{ methodResponses?: MethodResponse[] }>(
    apiUrl,
    token,
    {
      method: "POST",
      body: JSON.stringify({ using: [CORE, MAIL, SUBMISSION], methodCalls }),
    },
  );
  return response.methodResponses ?? [];
}

function responseFor(
  responses: MethodResponse[],
  name: string,
  id: string,
): JsonObject {
  const response = responses.find(
    (item) => item[2] === id && (item[0] === name || item[0] === "error"),
  );
  if (!response) throw new Error(`JMAP ${name} response missing`);
  if (response[0] === "error") {
    const errorType = response[1].type;
    throw new Error(
      `JMAP ${name} failed: ${typeof errorType === "string" ? errorType : "error"}`,
    );
  }
  return response[1];
}

async function context(token: string, fromEmail: string): Promise<SendContext> {
  const session = await jmapFetch<JmapSession>(SESSION_URL, token);
  const mailAccountId = session.primaryAccounts?.[MAIL];
  const submissionAccountId =
    session.primaryAccounts?.[SUBMISSION] ?? mailAccountId;
  if (!session.apiUrl || !mailAccountId || !submissionAccountId)
    throw new Error("JMAP session is missing an account");

  const responses = await call(session.apiUrl, token, [
    ["Identity/get", { accountId: submissionAccountId, ids: null }, "identity"],
    ["Mailbox/get", { accountId: mailAccountId, ids: null }, "mailboxes"],
  ]);
  const identities = (responseFor(responses, "Identity/get", "identity").list ??
    []) as Array<{
    id?: string;
    email?: string;
  }>;
  const mailboxes = (responseFor(responses, "Mailbox/get", "mailboxes").list ??
    []) as Array<{
    id?: string;
    role?: string;
  }>;
  const identity =
    identities.find(
      (item) => item.email?.toLowerCase() === fromEmail.toLowerCase(),
    ) ?? identities[0];
  const drafts = mailboxes.find((item) => item.role === "drafts");
  const sent = mailboxes.find((item) => item.role === "sent");
  if (!identity?.id)
    throw new Error(`No JMAP identity is available for ${fromEmail}`);
  if (!drafts?.id || !sent?.id)
    throw new Error("JMAP Drafts or Sent mailbox is missing");
  return {
    apiUrl: session.apiUrl,
    mailAccountId,
    submissionAccountId,
    identityId: identity.id,
    draftsId: drafts.id,
    sentId: sent.id,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function defaultImageUrl(magicLink: string): string {
  try {
    return new URL("/assets/elixir-hype.png", magicLink).toString();
  } catch {
    return "https://drop.poapkings.com/assets/elixir-hype.png";
  }
}

export function magicLinkEmailSubject(): string {
  return "Your Elixir Drop sign-in link";
}

export function magicLinkEmailText({
  magicLink,
  expiresMinutes,
}: MagicLinkEmailInput): string {
  return [
    "Elixir Drop is ready.",
    "",
    "Use this private link to sign in and start your next game:",
    "",
    magicLink,
    "",
    `This link expires in ${expiresMinutes} minutes and can only be used once.`,
    "Every game counts toward your player profile and the seasonal leaderboards.",
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");
}

export function magicLinkEmailHtml({
  magicLink,
  expiresMinutes,
  imageUrl = defaultImageUrl(magicLink),
}: MagicLinkEmailInput): string {
  const safeLink = escapeHtml(magicLink);
  const safeImageUrl = escapeHtml(imageUrl);
  const safeMinutes = escapeHtml(String(expiresMinutes));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${magicLinkEmailSubject()}</title>
  </head>
  <body style="margin:0;background:#f4f0fa;color:#21172f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;font-size:1px;">Your private, one-time link to play Elixir Drop.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#f4f0fa;margin:0;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:520px;background:#ffffff;border:1px solid #ded4ed;border-radius:22px;overflow:hidden;box-shadow:0 18px 50px rgba(53,31,83,0.12);">
            <tr>
              <td align="center" style="padding:34px 28px 10px;">
                <img src="${safeImageUrl}" width="128" height="128" alt="Elixir Drop" style="display:block;width:128px;height:128px;border:0;margin:0 auto 14px;">
                <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#76569c;font-weight:800;">Elixir Drop</div>
                <h1 style="font-size:30px;line-height:1.15;margin:10px 0 0;color:#21172f;font-weight:800;">Ready to Drop?</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 34px 8px;text-align:center;">
                <p style="font-size:16px;line-height:1.55;margin:0;color:#51435f;">Your next game is waiting. Use this private link to sign in to Elixir Drop.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 34px 14px;">
                <a href="${safeLink}" style="display:inline-block;background:#f4c542;color:#21172f;text-decoration:none;border:1px solid #d8a91f;border-radius:999px;padding:15px 24px;font-size:16px;line-height:1;font-weight:800;box-shadow:0 8px 20px rgba(216,169,31,0.25);">Sign in to Elixir Drop</a>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 34px 30px;text-align:center;">
                <p style="font-size:13px;line-height:1.55;margin:0;color:#786986;">This link expires in ${safeMinutes} minutes and can only be used once.<br>Every game counts toward your profile and the seasonal leaderboards.</p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8f5fc;border-top:1px solid #e8e0f1;padding:18px 24px;text-align:center;">
                <p style="font-size:12px;line-height:1.55;margin:0;color:#756781;">If the button does not work, paste this link into your browser:<br><a href="${safeLink}" style="color:#654292;word-break:break-all;">${safeLink}</a></p>
              </td>
            </tr>
          </table>
          <p style="font-size:12px;line-height:1.5;margin:16px 0 0;color:#81758b;">If you did not request this, you can safely ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendEmail(input: SendEmailInput): Promise<void> {
  const sendContext = await context(input.token, input.fromEmail);

  const responses = await call(sendContext.apiUrl, input.token, [
    [
      "Email/set",
      {
        accountId: sendContext.mailAccountId,
        create: {
          draft: {
            mailboxIds: { [sendContext.draftsId]: true },
            keywords: { $draft: true },
            from: [{ name: input.fromName, email: input.fromEmail }],
            to: [{ email: input.to }],
            subject: input.subject,
            bodyStructure: {
              type: "multipart/alternative",
              subParts: [
                { partId: "text", type: "text/plain" },
                { partId: "html", type: "text/html" },
              ],
            },
            bodyValues: {
              text: { value: input.text, charset: "utf-8" },
              html: { value: input.html, charset: "utf-8" },
            },
          },
        },
      },
      "email",
    ],
    [
      "EmailSubmission/set",
      {
        accountId: sendContext.submissionAccountId,
        onSuccessUpdateEmail: {
          "#send": {
            [`mailboxIds/${sendContext.sentId}`]: true,
            [`mailboxIds/${sendContext.draftsId}`]: null,
            "keywords/$draft": null,
          },
        },
        create: {
          send: {
            emailId: "#draft",
            identityId: sendContext.identityId,
            envelope: {
              mailFrom: { email: input.fromEmail },
              rcptTo: [{ email: input.to }],
            },
          },
        },
      },
      "submit",
    ],
  ]);
  const emailResult = responseFor(responses, "Email/set", "email");
  const submitResult = responseFor(responses, "EmailSubmission/set", "submit");
  if ((emailResult.notCreated as Record<string, unknown> | undefined)?.draft)
    throw new Error("JMAP email creation failed");
  if ((submitResult.notCreated as Record<string, unknown> | undefined)?.send)
    throw new Error("JMAP email submission failed");
}

export async function sendMagicLink(input: SendMagicLinkInput): Promise<void> {
  await sendEmail({
    ...input,
    subject: magicLinkEmailSubject(),
    text: magicLinkEmailText(input),
    html: magicLinkEmailHtml(input),
  });
}

export function mailCanaryEmailSubject(): string {
  return "Elixir Drop mail canary";
}

export async function sendMailCanary(
  input: SendMailCanaryInput,
): Promise<void> {
  const observedAt = (input.observedAt ?? new Date()).toISOString();
  const subject = mailCanaryEmailSubject();
  const text = [
    "Elixir Drop email delivery canary.",
    "",
    `Submitted at ${observedAt}.`,
    "This automated message confirms the same Fastmail JMAP submission path used by player magic links.",
  ].join("\n");
  await sendEmail({
    ...input,
    subject,
    text,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${subject}</title></head><body><p>Elixir Drop email delivery canary.</p><p>Submitted at ${observedAt}.</p><p>This automated message confirms the same Fastmail JMAP submission path used by player magic links.</p></body></html>`,
  });
}
