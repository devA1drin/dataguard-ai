import zxcvbn from "zxcvbn";

/**
 * Password policy (same rules in the browser strength meter):
 *  - 12 to 128 characters
 *  - zxcvbn score >= 3 ("safely unguessable"), checked offline - no password ever leaves the server
 *  - must not contain the e-mail name or the user's name
 */
export const MIN_LENGTH = 12;
export const MIN_SCORE = 3;

export function checkPassword(pw: string, email = "", name = ""): { ok: boolean; score: number; problems: string[]; suggestions: string[] } {
  const words = [email, email.split("@")[0], ...name.split(/\s+/), "dataguard", "password"].filter((w) => w && w.length >= 3);
  const r = zxcvbn(pw.slice(0, 128), words);
  const problems: string[] = [];
  if (pw.length < MIN_LENGTH) problems.push(`Use at least ${MIN_LENGTH} characters.`);
  if (pw.length > 128) problems.push("Use at most 128 characters.");
  const local = email.split("@")[0].toLowerCase();
  if (local.length >= 3 && pw.toLowerCase().includes(local)) problems.push("Don't include your e-mail name.");
  if (r.score < MIN_SCORE) problems.push(r.feedback.warning || "This password is too easy to guess.");
  return { ok: problems.length === 0, score: r.score, problems, suggestions: r.feedback.suggestions };
}
