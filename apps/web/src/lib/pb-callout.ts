// The summary's one-line "how did that run compare?" banner.
//
// Every mode showed the same three-state chain — beat the standing best, set
// the first one, or fell short of it — written out as its own nested ternary.
// This is that chain once; each mode supplies only its own words.

export interface PbCalloutCopy {
  /** There was no earlier best to beat, e.g. "First Surge logged". */
  first: string
  /** The run beat `previousBest`, e.g. "New best! −1.20s". */
  improved: (previousBest: number) => string
  /** The run did not beat `previousBest`, e.g. "Best: 12.30s". */
  standing: (previousBest: number) => string
}

export function pbCallout(isPB: boolean, previousBest: number | undefined, copy: PbCalloutCopy): string | undefined {
  if (previousBest === undefined) return isPB ? copy.first : undefined
  return isPB ? copy.improved(previousBest) : copy.standing(previousBest)
}

// A streak/count record of 0 is a recorded run, not a mark worth beating: read
// it as "no previous best" so the summary offers the first-run line instead of
// "Best: 0". Golf-time modes cannot record a 0, so they pass the record raw.
export function comparableBest(record: number | undefined): number | undefined {
  return record !== undefined && record > 0 ? record : undefined
}
