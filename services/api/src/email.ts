import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * Drop's outbound mail: the magic-link sign-in email, sent as
 * elixir@poapkings.com over SES (2026-09-17). Fastmail JMAP was the sender
 * before; Fastmail is a mailbox, not a sender, and the poapkings.com identity
 * (DKIM, MAIL FROM bounce.poapkings.com) is owned by the elixir-mcp stack.
 * Drop sends through its own configuration set (infra/template.yaml,
 * SenderConfigurationSet) so bounces and complaints reach Drop's alarm topic.
 * No open or click tracking: nothing is added to the body, no link is
 * rewritten.
 *
 * multipart/alternative, never HTML alone: a client that will not render
 * HTML must still be able to read a sign-in code.
 */

interface SendMagicLinkInput {
  fromEmail: string;
  fromName: string;
  to: string;
  magicLink: string;
  code: string;
  expiresMinutes: number;
  configurationSet: string;
}

interface SendEmailInput {
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  configurationSet: string;
}

interface MagicLinkEmailInput {
  magicLink: string;
  code: string;
  expiresMinutes: number;
  imageUrl?: string;
}

let client: SESv2Client | undefined;
function ses(): SESv2Client {
  client ??= new SESv2Client({});
  return client;
}

/** Test seam: swap the SES client (and reset with undefined). */
export function setSesClient(next: SESv2Client | undefined): void {
  client = next;
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
  await ses().send(
    new SendEmailCommand({
      FromEmailAddress: `${input.fromName} <${input.fromEmail}>`,
      Destination: { ToAddresses: [input.to] },
      ConfigurationSetName: input.configurationSet,
      Content: {
        Simple: {
          Subject: { Data: input.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: input.text, Charset: "UTF-8" },
            Html: { Data: input.html, Charset: "UTF-8" },
          },
        },
      },
    }),
  );
}

export async function sendMagicLink(input: SendMagicLinkInput): Promise<void> {
  await sendEmail({
    ...input,
    subject: magicLinkEmailSubject(input.code),
    text: magicLinkEmailText(input),
    html: magicLinkEmailHtml(input),
  });
}
