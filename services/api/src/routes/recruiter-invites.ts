import { HttpError } from "../errors.js";
import {
  publishedPageResponse,
  renderPublishedSharePage,
} from "../published-page.js";
import {
  isRecruiterInviteReference,
  recruiterInviteUrl,
} from "../recruiter.js";
import type { RouteContext } from "./context.js";

export async function getRecruiterInvitePage(
  context: RouteContext,
  dropPlayerTag: string,
  head = false,
) {
  if (!isRecruiterInviteReference(dropPlayerTag))
    throw new HttpError(
      404,
      "That Elixir Drop invitation could not be found.",
      "not_found",
    );
  const normalizedTag = dropPlayerTag.toUpperCase();
  const player = await context.repository.getRecruiterInvite(normalizedTag);
  if (!player)
    throw new HttpError(
      404,
      "That Elixir Drop invitation could not be found.",
      "not_found",
    );

  const body = renderPublishedSharePage({
    title: "Learn Clash Royale elixir costs | Elixir Drop",
    description:
      "Play the free Clash Royale elixir-cost game and see how high you can climb.",
    canonical: recruiterInviteUrl(context.config.appUrl, player.player.id),
    image: `${context.config.appUrl}/assets/share/og-default.png`,
    imageAlt: "Elixir Drop, the free Clash Royale elixir-cost game",
    challenge: `${context.config.appUrl}/#/`,
    cta: "PLAY ELIXIR DROP",
    pitch:
      "Learn Clash Royale elixir costs, climb your arena, and build a badge wall of your own.",
    scriptSrc: "/assets/share/invite-open.js",
    bodyData: { "share-drop-player-tag": normalizedTag },
  });
  return publishedPageResponse(body, head);
}
