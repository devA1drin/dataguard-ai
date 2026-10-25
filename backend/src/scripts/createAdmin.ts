/**
 * Create (or promote) an administrator account from the command line.
 *
 *   npm run create-admin                      # asks for e-mail, name and password
 *   npm run create-admin -- you@example.com   # e-mail as an argument
 *
 * Uses DATABASE_URL like the API. The password is typed hidden and must pass the same
 * policy as the website (12+ characters, hard to guess). Nothing is printed except the result.
 */
import bcrypt from "bcryptjs";
import readline from "readline";
import { pool } from "../db";
import { audit } from "../lib/audit";
import { checkPassword } from "../lib/password";

// One shared readline interface with a line queue, so it works both interactively and with piped input.
const tty = Boolean(process.stdin.isTTY);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
let muted = false;
const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
const origWrite = out._writeToOutput?.bind(rl);
out._writeToOutput = (s: string) => { if (!muted) origWrite?.(s); else if (!/[\r\n]/.test(s)) out.output.write("*"); };
const queue: string[] = [];
let waiting: ((l: string) => void) | null = null;
rl.on("line", (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else queue.push(l); });

function ask(q: string, hidden = false): Promise<string> {
  process.stdout.write(q);
  muted = hidden && tty;
  return new Promise((resolve) => {
    const done = (a: string) => { muted = false; if (hidden && tty) process.stdout.write("\n"); else if (!tty) process.stdout.write("\n"); resolve(a.trim()); };
    if (queue.length) done(queue.shift()!); else waiting = done;
  });
}

async function main() {
  const email = (process.argv[2] || (await ask("Admin e-mail: "))).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That doesn't look like an e-mail address.");
  const [existing] = (await pool.query("SELECT id, role, full_name FROM users WHERE lower(email)=$1", [email])).rows;
  if (existing?.role === "customer") throw new Error("That e-mail belongs to a customer account. Use a different e-mail for the admin.");
  const name = existing?.full_name || (await ask("Full name: ")) || "Administrator";
  for (;;) {
    const pw = await ask("Password (hidden): ", true);
    const check = checkPassword(pw, email, name);
    if (!check.ok) { console.log("  Not strong enough: " + check.problems.join(" ")); continue; }
    if ((await ask("Repeat password: ", true)) !== pw) { console.log("  The passwords don't match."); continue; }
    const hash = await bcrypt.hash(pw, 12);
    let id: number;
    if (existing) {
      if ((await ask(`An account for ${email} exists (role ${existing.role}). Make it admin and set this password? [y/N] `)).toLowerCase() !== "y") return;
      await pool.query("UPDATE users SET role='admin', password_hash=$2, is_active=true, locked_until=NULL, failed_login_count=0, password_changed_at=now() WHERE id=$1", [existing.id, hash]);
      id = existing.id;
    } else {
      id = (await pool.query("INSERT INTO users (email, password_hash, full_name, role, password_changed_at) VALUES ($1,$2,$3,'admin',now()) RETURNING id",
        [email, hash, name])).rows[0].id;
    }
    await audit({ actorId: null, actorRole: "system", action: "user.create_admin_cli", entityType: "user", entityId: id, details: { promoted: Boolean(existing) } });
    console.log(`Admin ready: ${email} (user #${id}). Sign in on the website, then turn on MFA under "My security".`);
    return;
  }
}

main().catch((e) => { console.error("create-admin failed: " + (e as Error).message); process.exitCode = 1; }).finally(() => { rl.close(); void pool.end(); });
