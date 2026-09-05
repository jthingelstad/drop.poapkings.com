import { emailSentFolder } from "./config.js";

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
  code: string;
  expiresMinutes: number;
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
  code: string;
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

export interface JmapMailbox {
  id?: string;
  name?: string;
  parentId?: string | null;
  role?: string;
}

/**
 * Pick the mailbox Drop files sent mail into.
 *
 * Only the account's top-level Sent carries the JMAP `sent` role; the per-agent
 * folders (Elixir-Sent, Thingy-Sent, ...) are plain named children of it. So a
 * role-only lookup silently files Drop's magic links into the folder shared with
 * every other agent. Prefer our named child; fall back to the role parent so a
 * renamed folder degrades to "misfiled" rather than "magic link never sent".
 */
export function pickSentMailbox(
  mailboxes: JmapMailbox[],
  sentRootId: string,
  folderName: string,
): JmapMailbox | undefined {
  const child = mailboxes.find(
    (item) => item.parentId === sentRootId && item.name === folderName,
  );
  if (child?.id) return child;
  return mailboxes.find((item) => item.id === sentRootId);
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
    [
      "Mailbox/get",
      {
        accountId: mailAccountId,
        ids: null,
        // name + parentId are required to find our own child of Sent; without
        // them only role matching is possible, which lands mail in shared Sent.
        properties: ["id", "name", "parentId", "role"],
      },
      "mailboxes",
    ],
  ]);
  const identities = (responseFor(responses, "Identity/get", "identity").list ??
    []) as Array<{
    id?: string;
    email?: string;
  }>;
  const mailboxes = (responseFor(responses, "Mailbox/get", "mailboxes").list ??
    []) as Array<{
    id?: string;
    name?: string;
    parentId?: string | null;
    role?: string;
  }>;
  const identity =
    identities.find(
      (item) => item.email?.toLowerCase() === fromEmail.toLowerCase(),
    ) ?? identities[0];
  const drafts = mailboxes.find((item) => item.role === "drafts");
  const sentRoot = mailboxes.find((item) => item.role === "sent");
  if (!identity?.id)
    throw new Error(`No JMAP identity is available for ${fromEmail}`);
  if (!drafts?.id || !sentRoot?.id)
    throw new Error("JMAP Drafts or Sent mailbox is missing");
  const sentFolderName = emailSentFolder();
  const sent = pickSentMailbox(mailboxes, sentRoot.id, sentFolderName);
  if (!sent?.id) throw new Error("JMAP Sent mailbox is missing");
  if (sent.id === sentRoot.id)
    console.warn(
      `JMAP: no "${sentFolderName}" under Sent; filing into the shared Sent folder`,
    );
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

// The sign-in email's hero image. This was the Elixir mascot until the emote
// set was retired; the app icon is the remaining brand mark that is safe to
// hotlink from an inbox.
function defaultImageUrl(magicLink: string): string {
  try {
    return new URL(DEFAULT_IMAGE_PATH, magicLink).toString();
  } catch {
    return `https://drop.poapkings.com${DEFAULT_IMAGE_PATH}`;
  }
}

const DEFAULT_IMAGE_PATH = "/assets/icon/drop-icon-512.png";

export function magicLinkEmailSubject(code: string): string {
  return `${code} is your Elixir Drop sign-in code`;
}

export function magicLinkEmailText({
  magicLink,
  code,
  expiresMinutes,
}: MagicLinkEmailInput): string {
  return [
    `${code} is your Elixir Drop sign-in code.`,
    "",
    "Enter this six-digit code on the sign-in page:",
    "",
    code,
    "",
    "Or use this private link:",
    "",
    magicLink,
    "",
    `The code and link expire in ${expiresMinutes} minutes. Either one can be used once.`,
    "Every game counts toward your player profile and the seasonal leaderboards.",
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");
}

export function magicLinkEmailHtml({
  magicLink,
  code,
  expiresMinutes,
  imageUrl = defaultImageUrl(magicLink),
}: MagicLinkEmailInput): string {
  const safeLink = escapeHtml(magicLink);
  const safeCode = escapeHtml(code);
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
    <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${safeCode} is your Elixir Drop sign-in code. It expires in ${safeMinutes} minutes.</span>
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
                      <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#d7cff0;">Enter the code on the sign-in page, or tap the button to skip the password and get straight to your next game.</p>
                      <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#a99fce;">Your sign-in code</p>
                      <p style="margin:0 0 14px;font-family:'Courier New',Courier,monospace;font-size:36px;line-height:1.2;font-weight:800;letter-spacing:8px;color:#ffffff;">${safeCode}</p>
                      <p style="margin:0 0 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#a99fce;">Move fast — the code and link expire in <strong style="color:#f5c84c;">${safeMinutes} minutes</strong>. Using either one signs you in and makes both single-use credentials unavailable.</p>
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
                      <p style="margin:22px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#a99fce;">Didn't ask to log in? No sweat — ignore this email and nothing happens. Your account stays exactly as you left it.</p>
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
  // Local dev only: with no Fastmail token, print the link to the terminal
  // instead of sending mail. Guarded by an explicit env var, so production
  // (where it is never set) is unchanged. The local dev harness sets it.
  if (process.env.ELIXIR_DROP_DEV_MAIL === "console") {
    console.log(
      `\n✉️  [dev] Magic link for ${input.to}:\n   ${input.magicLink}\n`,
    );
    return;
  }
  await sendEmail({
    ...input,
    subject: magicLinkEmailSubject(input.code),
    text: magicLinkEmailText(input),
    html: magicLinkEmailHtml(input),
  });
}
