// RaceLogger share backend — one function, blob in / blob out.
// POST /api/session        body = session bundle JSON  -> { id }
// GET  /api/session/:id                                -> the bundle JSON
// Storage: Netlify Blobs, store "sessions". No auth — ids are unguessable
// 80-bit random strings and sessions contain no secrets (GPS traces of a
// public racetrack). Size-capped to keep the store tidy.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("sessions");
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["api","session",id?]

  if (req.method === "POST") {
    const body = await req.text();
    if (body.length > 8 * 1024 * 1024)
      return new Response("session too large", { status: 413 });
    try {
      const j = JSON.parse(body);
      if (j.app !== "RaceLogger" || !("attempts" in j)) throw 0;
    } catch {
      return new Response("not a RaceLogger session", { status: 400 });
    }
    const id = [...crypto.getRandomValues(new Uint8Array(10))]
      .map(b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
    await store.set(id, body);
    return Response.json({ id });
  }

  if (req.method === "GET") {
    const id = (parts[2] || "").replace(/[^a-z0-9]/g, "");
    if (!id) return new Response("missing id", { status: 400 });
    const data = await store.get(id);
    if (data == null) return new Response("not found", { status: 404 });
    return new Response(data, {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("method not allowed", { status: 405 });
};

export const config = { path: ["/api/session", "/api/session/*"] };
