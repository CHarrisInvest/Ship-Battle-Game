/**
 * A Postgres for the server's tests.
 *
 * `TEST_DATABASE_URL` when it is set, which is how CI hands one over (a service container). Otherwise
 * a throwaway `postgres:17` container on a free port, waited on until it takes connections, and
 * removed when the tests are done. Each run gets a fresh database either way: with a URL, every
 * table is dropped first, so a test never reads what the last run left.
 */

import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.unref();
  s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function waitFor(url, seconds = 60) {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const c = new pg.Client({ connectionString: url });
    try { await c.connect(); await c.query("select 1"); await c.end(); return; } catch (e) {
      try { await c.end(); } catch { /* not open */ }
      if (Date.now() > until) throw new Error(`Postgres never came up: ${e.message}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** `{ url, stop }`: a database to test against, and how to be rid of it. */
export async function testDatabase() {
  if (process.env.TEST_DATABASE_URL) {
    const url = process.env.TEST_DATABASE_URL;
    await waitFor(url);
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query("drop schema public cascade; create schema public;");
    await c.end();
    return { url, stop: async () => {} };
  }
  const port = await freePort();
  const name = `sternchase-test-${process.pid}`;
  const run = spawnSync("docker", [
    "run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=test",
    "-p", `127.0.0.1:${port}:5432`, "postgres:17",
  ], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`could not start a Postgres container: ${run.stderr || run.stdout}`);
  const url = `postgres://postgres:test@127.0.0.1:${port}/test`;
  await waitFor(url);
  return { url, stop: async () => { spawnSync("docker", ["rm", "-f", name], { encoding: "utf8" }); } };
}
