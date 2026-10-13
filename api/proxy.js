/**
 * THE GAME'S DOOR TO ITS SERVER — every request to `/api/*` on the game's own domain, sent on to the
 * game server on Railway. `vercel.json` routes every `/api/*` path here.
 *
 * The game and its server have to look like one site to the browser, or the session cookie is a
 * third-party cookie and Safari refuses it. So the browser only ever talks to the game's domain, and
 * this edge function forwards `/api/*` there, path and query unchanged, adding two things only it
 * can: the shared secret the server demands of every request (so nobody reaches the server around
 * this door), and the visitor's address as Vercel saw it (so the server's limits count visitors, not
 * this function). Whatever a visitor sends in those two headers is thrown away first.
 *
 *   API_UPSTREAM   the server's own address, e.g. https://server-production-08778.up.railway.app
 *   PROXY_SECRET   the secret the server is configured with
 */

export const config = { runtime: "edge" };

// headers that describe one hop, or that only this function may set
const DROP_IN = ["host", "connection", "x-sternchase-proxy", "x-client-ip", "content-length"];
// the body comes back already decoded, so the encoding and length it was sent with no longer apply
const DROP_OUT = ["content-encoding", "content-length", "transfer-encoding", "connection"];

export default async function handler(request) {
  const upstream = process.env.API_UPSTREAM;
  const secret = process.env.PROXY_SECRET;
  if (!upstream || !secret) return Response.json({ error: "the server is not configured" }, { status: 503 });

  // `vercel.json` rewrites every `/api/<path>` here as `/api/proxy?__path=<path>`, because outside
  // Next.js Vercel will not route a path of several segments to a catch-all file
  const url = new URL(request.url);
  const routed = url.searchParams.get("__path");
  if (routed === null) return Response.json({ error: "not found" }, { status: 404 });
  url.searchParams.delete("__path");
  const path = "/api/" + routed.split("/").map((seg) => encodeURIComponent(decodeURIComponent(seg))).join("/");
  const headers = new Headers(request.headers);
  for (const h of DROP_IN) headers.delete(h);
  headers.set("x-sternchase-proxy", secret);
  const ip = request.headers.get("x-real-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (ip) headers.set("x-client-ip", ip);

  const hasBody = !["GET", "HEAD"].includes(request.method);
  let res;
  try {
    res = await fetch(upstream.replace(/\/$/, "") + path + url.search, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
    });
  } catch {
    return Response.json({ error: "the server could not be reached" }, { status: 502 });
  }
  const out = new Headers();
  for (const [k, v] of res.headers) if (!DROP_OUT.includes(k) && k !== "set-cookie") out.append(k, v);
  for (const c of res.headers.getSetCookie()) out.append("set-cookie", c);
  return new Response(res.body, { status: res.status, headers: out });
}
