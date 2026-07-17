// RaceLogger — © 2026 Josh "Yoshi" Retief. All rights reserved. See LICENSE.
// Venue leaderboards. Entry-per-blob (no read-modify-write races):
//   POST /api/lb            {key, driver, time, sid?}   -> {ok}
//   GET  /api/lb/:key       -> {top:[best per driver], count}
// key = startline coords (3dp) + mode + lap-length bucket — same physical
// venue & layout resolves to the same board from any phone. Club-trust:
// times aren't verified, but entries can carry a shared session (sid) so
// anyone can open the actual lap.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("leaderboard");
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["api","lb",key?]

  if (req.method === "POST") {
    const b = await req.json().catch(() => null);
    if (!b || typeof b.key !== "string" || !/^[a-z0-9.x-]{5,60}$/.test(b.key)
        || typeof b.time !== "number" || b.time < 5 || b.time > 3600)
      return new Response("bad entry", { status: 400 });
    const entry = {
      driver: String(b.driver || "anon").slice(0, 24),
      time: +b.time.toFixed(2),
      date: Date.now(),
      sid: (typeof b.sid === "string" && /^[a-z0-9]{1,20}$/.test(b.sid)) ? b.sid : null,
    };
    const id = [...crypto.getRandomValues(new Uint8Array(8))]
      .map(x => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("");
    await store.setJSON(b.key + "/" + id, entry);
    return Response.json({ ok: true });
  }

  if (req.method === "GET") {
    const key = decodeURIComponent(parts[2] || "");
    if (!/^[a-z0-9.x-]{5,60}$/.test(key))
      return new Response("bad key", { status: 400 });
    const { blobs } = await store.list({ prefix: key + "/" });
    // parallel reads — sequential fetches made big boards crawl (and the app
    // now queries 3 adjacent lap-length buckets per view)
    const got = await Promise.all(blobs.slice(0, 200).map(bl =>
      store.get(bl.key, { type: "json" }).catch(() => null)));
    const entries = got.filter(e => e && typeof e.time === "number");
    entries.sort((a, b) => a.time - b.time);
    const seen = new Set(), top = [];
    for (const e of entries) {
      const k = (e.driver || "").toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      top.push(e);
      if (top.length >= 20) break;
    }
    return Response.json({ top, count: entries.length });
  }

  return new Response("method not allowed", { status: 405 });
};

export const config = { path: ["/api/lb", "/api/lb/*"] };
