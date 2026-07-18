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
  if (response[0] === "error")
    throw new Error(
      `JMAP ${name} failed: ${String(response[1].type ?? "error")}`,
    );
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

export async function sendMagicLink(input: SendMagicLinkInput): Promise<void> {
  const sendContext = await context(input.token, input.fromEmail);
  const safeLink = escapeHtml(input.magicLink);
  const subject = "Your Elixir Drop login link";
  const text = [
    "Ready to Drop?",
    "",
    "Use this private link to sign in:",
    input.magicLink,
    "",
    `This link expires in ${input.expiresMinutes} minutes and can only be used once.`,
    "If you did not request it, you can ignore this email.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#171126;color:#fff;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#24183b;border:1px solid #6d4f92;border-radius:20px"><tr><td align="center" style="padding:36px 30px"><div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#d5b7ff">Elixir Drop</div><h1 style="font-size:30px;margin:12px 0 14px">Ready to Drop?</h1><p style="font-size:16px;line-height:1.5;color:#e8dcf6">Sign in to save every game, climb the seasonal leaderboards, and keep grinding your player level.</p><a href="${safeLink}" style="display:inline-block;margin:14px 0;background:#f4c542;color:#21172f;text-decoration:none;border-radius:999px;padding:14px 24px;font-weight:700">Sign in to Elixir Drop</a><p style="font-size:13px;line-height:1.5;color:#bba9ce">This link expires in ${input.expiresMinutes} minutes and works once.</p></td></tr></table></td></tr></table></body></html>`;

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
            subject,
            bodyStructure: {
              type: "multipart/alternative",
              subParts: [
                { partId: "text", type: "text/plain" },
                { partId: "html", type: "text/html" },
              ],
            },
            bodyValues: {
              text: { value: text, charset: "utf-8" },
              html: { value: html, charset: "utf-8" },
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
