import MetaPageHead from '../components/MetaPageHead'
import MetaSection from '../components/MetaSection'
import ReviewStatusMark from '../components/ReviewStatus'
import { contactEmailHref, ELIXIR_DROP_CONTACT_EMAIL } from '../lib/links'

export default function FairPlay() {
  return (
    <article class="ed-page ed-page--fair-play">
      <MetaPageHead eyebrow="Competitive integrity" title="Fair Play" />
      <p class="ed-page__intro">
        Drop is open source, and learning how it works is welcome. Ranked results still have one simple requirement: a
        person must deliberately choose every answer through the game&rsquo;s controls.
      </p>

      <div class="ed-meta-sections">
        <MetaSection title="Play as a person">
          <p>
            Scripts, bots, automatic answer selection, direct API play, replayed requests, and falsified timing evidence
            are not eligible for rankings. Built-in settings such as Reduce motion and Speedrun keyboard—and ordinary
            accessibility tools—are allowed when the player still chooses each answer.
          </p>
        </MetaSection>

        <MetaSection title="How review works">
          <p>
            Leading or technically unusual results may be reviewed. A referee reviews the exact run, including its
            signed challenge, answer sequence, active response timing, rules version, and relevant play history. An
            automatic signal starts review; it is never a verdict by itself. A run ranks provisionally while it waits,
            so nobody has to watch an empty spot on the board.
          </p>
          <p>
            <strong>Most games are never reviewed, and they carry no mark at all.</strong> A seal appears only where a
            referee has actually handled the run — an unmarked score is an ordinary eligible one, not a lesser one.
          </p>
          <ul class="ed-fair-play-statuses" aria-label="Fair Play review statuses">
            <li>
              <ReviewStatusMark status="pending" size={32} label />
              <span>
                A referee is checking the run. It is recorded and ranks provisionally while that happens, and its
                placement can still change.
              </span>
            </li>
            <li>
              <ReviewStatusMark status="reviewed" size={32} label />
              <span>A referee checked this exact run and it remains eligible for its correct placement.</span>
            </li>
            <li>
              <ReviewStatusMark status="excluded" size={32} label />
              <span>
                The run leaves the board; its owner sees a brief explanation, and the player&rsquo;s next eligible
                result can still rank. A later re-review can restore it to its correct rank.
              </span>
            </li>
          </ul>
        </MetaSection>

        <MetaSection title="Recorded holds and unrecorded attempts">
          <p>
            When Drop can reproduce a score but needs an authenticity review, it records the game, ranks it, and marks
            that same run Awaiting. If incomplete or contradictory input leaves no reproducible score, Drop cannot
            record a ranked result; the on-screen notice gives you a short Drop run tag such as #D7K4M9Q2RX1 instead.
            That tag identifies the attempt for referee lookup while retained evidence is available, but an unrecorded
            attempt does not receive a leaderboard status or appear as a scored game in history.
          </p>
        </MetaSection>

        <MetaSection title="Results and accounts">
          <p>
            Drop excludes the specific performance when strong evidence shows it was fabricated or materially assisted
            by automation. Repeated confirmed violations or one decisive tampering case may lead to a separate,
            reversible restriction on future ranked play after operator approval. That restriction does not delete the
            account, its history, or the evidence needed for review; Practice remains available.
          </p>
        </MetaSection>

        <MetaSection title="Privacy and re-review">
          <p>
            Review evidence stays private. Drop does not publish accusations, answer transcripts, connection
            fingerprints, or private reasons. If you believe a result or ranked-access decision is wrong, email{' '}
            <a href={contactEmailHref('Elixir Drop Fair Play re-review')}>{ELIXIR_DROP_CONTACT_EMAIL}</a> and ask for
            re-review. When the request concerns a specific result, include its run tag: open the game under Your games
            on your profile, and a reviewed run shows its tag there.
          </p>
        </MetaSection>
      </div>
    </article>
  )
}
