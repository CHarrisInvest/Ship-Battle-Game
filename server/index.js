/** The game server, as Railway runs it: `npm run server`. */

import { createServer } from "node:http";
import pg from "pg";
import { configFromEnv } from "./config.js";
import { createApp } from "./app.js";

const config = configFromEnv();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
const app = await createApp({ pool, config });
const server = createServer(app.handler);
server.listen(config.port, () => console.log(`sternchase server on :${config.port}, engine ${app.engine}`));

const stop = async () => {
  server.close();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
