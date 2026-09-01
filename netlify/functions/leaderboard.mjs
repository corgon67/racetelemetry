// RaceLogger — © 2026 Josh "Yoshi" Retief. All rights reserved. See LICENSE.
// Venue leaderboards. ONE blob per (venue key, driver): bounded reads, no
// "first 200 in random order" truncation, and a name can only be updated by
// the phone that first claimed it on that board (per-install token).
//   POST /api/lb            {key, driver, time, sid?, token}   -> {ok, improved}
//                           409 = that name belongs to another phone here
//   GET  /api/lb/:key       -> {top:[best per driver], count}
// key = startline coords (3dp) + mode + lap-length bucket — same physical
// venue & layout resolves to the same board from any phone. Club-trust:
// times aren't verified beyond plausibility, but entries can carry a shared
// session (sid) so anyone can open the actual lap.
import { getStore } from "@netlify/blobs";

const KEY_RE = /^[a-z0-9.x-]{5,60}$/;
const NAME_RE = /^[\p{L}\p{N} .'_-]{1,24}$/u;

export default async (req) => {
  const store = getStore("leaderboard");
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["api","lb",key?]

  if (req.method === "POST") {
    const b = await req.json().catch(() => null);
    if (!b || typeof b.key !== "string" || !KEY_RE.test(b.key)
        || typeof b.time !== "number" || !Number.isFinite(b.time) || b.time < 5 || b.time > 3600
        || typeof b.driver !== "string" || !NAME_RE.test(b.driver.trim())
        || typeof b.token !== "string" || !/^[0-9a-f]{16,64}$/.test(b.token))
      return new Response("bad entry", { status: 400 });
    // plausibility: the key ends in the lap-length bucket (metres/100). A lap
    // faster than 70 m/s average is not a car lap on a club venue.
    const m = b.key.match(/x(\d+)$/);
    const lapM = m ? +m[1] * 100 : 0;
    if (lapM && b.time < lapM / 70) return new Response("implausible time", { status: 400 });
    const driver = b.driver.trim();
    const slot = b.key + "/" + driver.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const cur = await store.get(slot, { type: "json" }).catch(() => null);
    if (cur && cur.token && cur.token !== b.token)
      return new Response("name taken on this board", { status: 409 });
    const time = +b.time.toFixed(2);
    if (cur && typeof cur.time === "number" && cur.time <= time)
      return Response.json({ ok: true, improved: false, best: cur.time });
    await store.setJSON(slot, {
      driver, time, date: Date.now(), token: b.token,
      sid: (typeof b.sid === "string" && /^[a-z0-9]{1,32}$/.test(b.sid)) ? b.sid : null,
    });
    return Response.json({ ok: true, improved: true });
  }

  if (req.method === "GET") {
    const key = decodeURIComponent(parts[2] || "");
    if (!KEY_RE.test(key)) return new Response("bad key", { status: 400 });
    const { blobs } = await store.list({ prefix: key + "/" });
    const got = await Promise.all(blobs.slice(0, 500).map(bl =>
      store.get(bl.key, { type: "json" }).catch(() => null)));
    const entries = got.filter(e => e && typeof e.time === "number")
      .map(({ token, ...e }) => e);   // the token never leaves the server
    entries.sort((a, b) => a.time - b.time);
    return Response.json({ top: entries.slice(0, 20), count: entries.length },
      { headers: { "cache-control": "public, max-age=30" } });
  }

  return new Response("method not allowed", { status: 405 });
};

export const config = { path: ["/api/lb", "/api/lb/*"] };
