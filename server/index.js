/** The game server, as Railway runs it: `npm run server`. */

import { createServer } from "node:http";
import pg from "pg";
import { configFromEnv } from "./config.js";
import { createApp } from "./app.js";
import { purge } from "./db.js";

const config = configFromEnv();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
const app = await createApp({ pool, config });
const server = createServer(app.handler);
server.listen(config.port, () => console.log(`sternchase server on :${config.port}, engine ${app.engine}`));

// what the privacy policy says is kept, and no more: at boot and every six hours
const clear = () => purge(pool, Date.now()).then(
  (n) => { if (n.guests || n.logs) console.log(`cleared ${n.guests} idle guests and ${n.logs} old input logs`); },
  (e) => console.error("purge failed", e),
);
clear();
const purging = setInterval(clear, 6 * 3600 * 1000);

const stop = async () => {
  clearInterval(purging);
  server.close();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
