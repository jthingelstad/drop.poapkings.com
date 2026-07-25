import type { RunTranscript } from "./types.js";

// Player XP is an ACTIVITY score, not a skill score. It counts how much you
// practice — never whether you were right. Every question you attempt in a
// scored run, right or wrong, earns one XP, so a longer session moves your arena
// more than a quick one and a beginner always makes progress. Skill lives
// entirely on the leaderboard, which ranks pure speed. Two separate systems: the
// arena is an inclusive personal journey for everyone; the boards are for the
// competitive.
//
// Awarded once per accepted run (rejected runs earn nothing) — EXCEPT Practice,
// which earns zero. Practice is endless, so per-question XP would make the arena
// farmable by simply never stopping; the exclusion is applied explicitly at the
// call site in routes/runs-complete.ts, not hidden in here.
//
// The transcript is already validated by scoreRun before this runs, so it reads
// leniently.
export function runXp(transcript: RunTranscript): number {
  const items = Array.isArray(transcript.answers)
    ? transcript.answers
    : Array.isArray(transcript.attempts)
      ? transcript.attempts
      : Array.isArray(transcript.picks)
        ? transcript.picks
        : [];
  // A floor of one keeps every completed game worth something even if the
  // transcript shape is unexpected.
  return Math.max(1, items.length);
}
