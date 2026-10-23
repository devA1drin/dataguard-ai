/** CLI: `npm run verify-audit` - recompute the audit hash chain and report tampering. */
import { pool } from "../db";
import { verifyChain } from "../lib/audit";

verifyChain().then((r) => {
  console.log(JSON.stringify(r, null, 2));
  return pool.end().then(() => process.exit(r.valid ? 0 : 1));
});
