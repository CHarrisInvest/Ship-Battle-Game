/**
 * The database: Better Auth's tables, created by Better Auth, and the server's own, from the numbered
 * files in `migrations/`, each run once and recorded.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMigrations } from "better-auth/db/migration";

const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate(pool, authOptions) {
  const { runMigrations } = await getMigrations(authOptions);
  await runMigrations();
  await pool.query("create table if not exists migrations (name text primary key, ran_at timestamptz not null default now())");
  const done = new Set((await pool.query("select name from migrations")).rows.map((r) => r.name));
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(readFileSync(join(dir, name), "utf8"));
      await client.query("insert into migrations (name) values ($1)", [name]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
}

/** Run `fn(client)` in a transaction, committing what it returns and rolling back what it throws. */
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

const DAY = 24 * 3600 * 1000;

/**
 * Keep only what the privacy policy says is kept. A guest last seen more than 90 days ago (her
 * account, her newest session and her hold all older than that) is deleted, and her hold and rounds
 * with her, by cascade; a signed-in captain is never deleted for being idle. A voyage's input log is
 * kept 30 days after it was finished or abandoned, and an open voyage nobody finished is abandoned
 * after a day. Returns how many guests and logs went.
 */
export async function purge(pool, now) {
  const guests = await pool.query(
    `delete from "user" u
      where u."isAnonymous" = true and u."updatedAt" < $1
        and not exists (select 1 from session s where s."userId" = u.id and s."updatedAt" >= $1)
        and not exists (select 1 from holds h where h.user_id = u.id and h.updated_at >= $1)`,
    [new Date(now - 90 * DAY)],
  );
  await pool.query("update rounds set abandoned_at = $1 where finished_at is null and abandoned_at is null and started_at < $2",
    [new Date(now), new Date(now - DAY)]);
  const logs = await pool.query(
    "delete from round_inputs where round_id in (select id from rounds where coalesce(finished_at, abandoned_at) < $1)",
    [new Date(now - 30 * DAY)],
  );
  return { guests: guests.rowCount, logs: logs.rowCount };
}
