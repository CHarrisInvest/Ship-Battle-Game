/**
 * The few things every route needs from `node:http`: a JSON body read with a size limit, a JSON
 * reply, and CORS for the game's own origins and nobody else's.
 */

/** Bodies over this are refused unread. A finish carries at most 5000 input entries, well under it. */
export const BODY_LIMIT = 1024 * 1024;

export class HttpError extends Error {
  constructor(status, body) {
    super(typeof body === "string" ? body : JSON.stringify(body));
    this.status = status;
    this.body = typeof body === "string" ? { error: body } : body;
  }
}

/** The request's JSON body, or an `HttpError` 400 for one that is not JSON or 413 for one too big. */
export async function readJson(req) {
  if (Number(req.headers["content-length"]) > BODY_LIMIT) throw new HttpError(413, "too big");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new HttpError(413, "too big");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw new HttpError(400, "not json");
  }
}

export function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}

/**
 * CORS headers for a request from one of `origins`, and none for anyone else. Returns true if the
 * request was a preflight and has been answered.
 */
export function cors(req, res, origins) {
  const origin = req.headers.origin;
  if (origin && origins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("vary", "Origin");
  }
  if (req.method !== "OPTIONS") return false;
  if (origin && origins.includes(origin)) {
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-max-age", "600");
  }
  res.writeHead(204);
  res.end();
  return true;
}
