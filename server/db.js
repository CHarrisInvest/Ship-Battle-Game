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
