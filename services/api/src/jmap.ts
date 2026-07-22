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
  // Dark purple/gold "Elixir Drop" brand email, matching design-ref/Elixir Drop
  // Login Email.html. The button + fallback use the app's real hash magic link.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>Log in to Elixir Drop</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0b0920;-webkit-text-size-adjust:100%;">
    <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">Your one-tap link to log in to Elixir Drop — expires in ${safeMinutes} minutes.</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0b0920;background-image:linear-gradient(180deg,#160f30,#0b0920);">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
            <tr>
              <td align="center" style="padding:8px 0 26px;">
                <img src="${safeImageUrl}" width="72" height="72" alt="Elixir Drop" style="display:block;width:72px;height:72px;border:0;margin:0 auto 12px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;letter-spacing:1px;color:#f7f4ff;">ELIXIR&nbsp;DROP</span>
              </td>
            </tr>
            <tr>
              <td style="background-color:#1a1030;background-image:linear-gradient(160deg,#2a1860,#160f30);border:1px solid #3a2a66;border-radius:22px;padding:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="height:5px;background-color:#f5c84c;background-image:linear-gradient(90deg,#8b5cf6,#f5c84c);border-radius:22px 22px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
                  <tr>
                    <td style="padding:34px 26px 30px;">
                      <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#c9b8ff;">Your arena awaits</p>
                      <h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.2;font-weight:800;color:#ffffff;">Ready to drop some elixir?</h1>
                      <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#d7cff0;">Tap the button, skip the password, and get straight to naming elixir costs faster than the other guy. Your streaks and season rank are waiting.</p>
                      <p style="margin:0 0 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#a99fce;">Move fast — this link only works once and self-destructs in <strong style="color:#f5c84c;">${safeMinutes} minutes</strong>.</p>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
                        <tr>
                          <td align="center" bgcolor="#f5c84c" style="border-radius:14px;background-color:#f5c84c;background-image:linear-gradient(135deg,#f5c84c,#c98c10);">
                            <a href="${safeLink}" target="_blank" style="display:block;padding:16px 40px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:800;letter-spacing:0.5px;color:#2a1500;text-decoration:none;border-radius:14px;">Let's drop!</a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#a99fce;">Button being stubborn? Paste this into your browser:</p>
                      <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.5;word-break:break-all;color:#c9b8ff;"><a href="${safeLink}" target="_blank" style="color:#c9b8ff;text-decoration:underline;">${safeLink}</a></p>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:28px 0 0;"><div style="height:1px;background-color:#3a2a66;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>
                      <p style="margin:22px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#a99fce;">Didn't ask to log in? No sweat — ignore this email and nothing happens. The link is useless until someone taps it, and your account stays exactly as you left it.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 24px 8px;" align="center">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a80ad;">Elixir Drop is a fan-made training game run by the <strong style="color:#c9b8ff;">POAP KINGS</strong> clan. Not affiliated with or endorsed by Supercell.</p>
              </td>
            </tr>
          </table>
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
