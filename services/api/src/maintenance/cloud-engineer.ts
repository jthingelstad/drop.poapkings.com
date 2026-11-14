// The identity every maintenance script checks before it reads or writes
// production. It lives on its own because each script in this directory is
// an entry point: bundled for `node`, its "am I the main module" guard is
// true for every module in the bundle, so a script that imported another
// script ran that one's `main` too (the name migration's dry run ran the
// avatar export, which failed on its missing --out and set exit code 1).
// Shared helpers belong in a module like this one, never in a script.

const EXPECTED_ACCOUNT = "999153317627";
const EXPECTED_ROLE_SESSION =
  "assumed-role/ProjectsCloudEngineer/projects-cloud-engineer";

/** True for the cloud-engineer session in Jamie's account, and nothing else:
 *  not the jamie profile, not a deploy role, not a user key. */
export function isCloudEngineerIdentity(identity: {
  Account?: string;
  Arn?: string;
}): boolean {
  return (
    identity.Account === EXPECTED_ACCOUNT &&
    typeof identity.Arn === "string" &&
    identity.Arn.startsWith(`arn:aws:sts::${EXPECTED_ACCOUNT}:`) &&
    identity.Arn.includes(EXPECTED_ROLE_SESSION)
  );
}
