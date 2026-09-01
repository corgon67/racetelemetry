// RaceLogger — © 2026 Josh "Yoshi" Retief. All rights reserved. See LICENSE.
// RaceLogger share backend — one function, blob in / blob out.
//   POST   /api/session       body = session/track bundle JSON  -> { id }
//   GET    /api/session/:id                                     -> the bundle JSON
//   DELETE /api/session/:id   body = { token }                  -> { ok }
// Storage: Netlify Blobs, store "sessions". Ids are 80-bit random strings.
// Every upload carries the uploader's per-install token (never returned on
// GET) so only that phone can revoke the link. Bodies are shape-checked and
// size-capped; uploads are rate-limited per IP so an open endpoint can't be
// used to run up the storage bill.
import { getStore } from "@netlify/blobs";

const MAX_BODY = 6 * 1024 * 1024;        // Netlify sync functions cap near 6 MB anyway
const RATE_MAX = 30, RATE_WIN = 60 * 60 * 1000;   // uploads per IP per hour
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";   // 32 symbols = 5 bits each

const rid = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => ALPHA[b & 31]).join("");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f<>]/g, "").slice(0, max);

async function rateOk(req, context) {
  try {
    const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "unknown";
    const rl = getStore("ratelimit");
    const k = "ip/" + ip.replace(/[^0-9a-f.:]/gi, "");
    const now = Date.now();
    let rec = await rl.get(k, { type: "json" }).catch(() => null);
    if (!rec || now - rec.t0 > RATE_WIN) rec = { t0: now, n: 0 };
    rec.n++;
    await rl.setJSON(k, rec);
    return rec.n <= RATE_MAX;
  } catch { return true; }   // a broken limiter must never block a real upload
}

// Strip a bundle down to the fields the app reads, with sane types. Returns
// null when it is not a RaceLogger bundle at all.
function shape(j) {
  if (!j || typeof j !== "object" || j.app !== "RaceLogger" || !Array.isArray(j.attempts)) return null;
  const num = (v, d) => (isNum(v) ? v : d);
  const gate = (g) => (g && typeof g === "object" && Math.abs(num(g.la, NaN)) <= 90 && Math.abs(num(g.lo, NaN)) <= 180)
    ? { id: clean(g.id, 24), role: ["startfinish", "start", "finish", "split"].includes(g.role) ? g.role : "split",
        la: g.la, lo: g.lo, name: clean(g.name, 16), code: clean(g.code, 4),
        heading: num(g.heading, 90), width: Math.max(4, Math.min(60, num(g.width, 16))),
        ...(g.dir != null && isNum(g.dir) ? { dir: g.dir } : {}) }
    : null;
  const sample = (p) => (p && typeof p === "object")
    ? { t: num(p.t, 0), la: num(p.la, undefined), lo: num(p.lo, undefined), v: num(p.v, 0),
        ay: num(p.ay, 0), ax: num(p.ax, undefined), ...(p.c != null ? { c: num(p.c, 0) } : {}) }
    : null;
  return {
    app: "RaceLogger", version: 1, kind: j.kind === "track" ? "track" : "session",
    track: clean(j.track || "Shared", 40), mode: j.mode === "stage" ? "stage" : "loop",
    driver: j.driver != null ? clean(j.driver, 24) : undefined,
    startedAt: num(j.startedAt, Date.now()), endedAt: j.endedAt != null ? num(j.endedAt, null) : null,
    gates: (Array.isArray(j.gates) ? j.gates : []).map(gate).filter(Boolean).slice(0, 40),
    outline: Array.isArray(j.outline)
      ? j.outline.filter(p => Array.isArray(p) && Math.abs(num(p[0], NaN)) <= 90 && Math.abs(num(p[1], NaN)) <= 180).map(p => [p[0], p[1]]).slice(0, 20000)
      : undefined,
    attempts: j.attempts.slice(0, 500).map((a, i) => ({
      n: num(a && a.n, i + 1), time: num(a && a.time, 0),
      splits: (a && a.splits && typeof a.splits === "object")
        ? Object.fromEntries(Object.entries(a.splits).slice(0, 40).map(([k, v]) => [clean(k, 24), num(v, 0)])) : {},
      samples: (Array.isArray(a && a.samples) ? a.samples : []).slice(0, 4000).map(sample).filter(Boolean),
      ts: num(a && a.ts, 0),
    })).filter(a => a.time > 0),
    trail10hz: (Array.isArray(j.trail10hz) ? j.trail10hz : []).slice(0, 40000).map(sample).filter(Boolean),
    hires: (Array.isArray(j.hires) ? j.hires : []).slice(0, 240000).map(sample).filter(Boolean),
  };
}

export default async (req, context) => {
  const store = getStore("sessions");
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["api","session",id?]
  const id = (parts[2] || "").replace(/[^a-z0-9]/g, "").slice(0, 32);

  if (req.method === "POST") {
    const len = +(req.headers.get("content-length") || 0);
    if (len > MAX_BODY) return new Response("session too large", { status: 413 });
    if (!(await rateOk(req, context))) return new Response("too many uploads — try later", { status: 429 });
    const body = await req.text();
    if (body.length > MAX_BODY) return new Response("session too large", { status: 413 });
    let j; try { j = JSON.parse(body); } catch { j = null; }
    const token = j && typeof j.token === "string" && /^[0-9a-f]{16,64}$/.test(j.token) ? j.token : null;
    const bundle = shape(j);
    if (!bundle) return new Response("not a RaceLogger session", { status: 400 });
    const newId = rid(16);
    await store.set(newId, JSON.stringify(bundle), { metadata: { token: token || "", at: Date.now() } });
    return Response.json({ id: newId });
  }

  if (req.method === "GET") {
    if (!id) return new Response("missing id", { status: 400 });
    const data = await store.get(id);
    if (data == null) return new Response("not found", { status: 404 });
    return new Response(data, {
      headers: { "content-type": "application/json", "cache-control": "private, max-age=300" },
    });
  }

  if (req.method === "DELETE") {
    if (!id) return new Response("missing id", { status: 400 });
    const b = await req.json().catch(() => null);
    const token = b && typeof b.token === "string" ? b.token : "";
    const meta = await store.getMetadata(id).catch(() => null);
    if (!meta) return new Response("not found", { status: 404 });
    const owner = (meta.metadata && meta.metadata.token) || "";
    if (!owner || owner !== token) return new Response("not yours", { status: 403 });
    await store.delete(id);
    return Response.json({ ok: true });
  }

  return new Response("method not allowed", { status: 405 });
};

export const config = { path: ["/api/session", "/api/session/*"] };
