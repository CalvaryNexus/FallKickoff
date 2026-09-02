/**
 * NEXUS FALL KICK OFF — Volunteer sign-up backend
 * Vercel serverless function, backed by Upstash Redis.
 *
 * Reads whichever REST credential pair Vercel's integration provisioned —
 * plain Upstash naming (UPSTASH_REDIS_REST_URL/TOKEN) or the Vercel-KV-
 * branded naming (KV_REST_API_URL/TOKEN) some Marketplace flows use for
 * the same underlying database.
 */
const { Redis } = require("@upstash/redis");
const { randomUUID } = require("crypto");

const restUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const restToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (!restUrl || !restToken) {
  throw new Error(
    "Missing Redis REST credentials — expected UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN in the project's environment variables."
  );
}
const redis = new Redis({ url: restUrl, token: restToken });
const KEY = "nexus:signups";

/**
 * Slot capacity. MUST match the `slots` values in index.html.
 * The server enforces these so two people can't grab the same last spot.
 * Pre-assigned people (Jonathon, Cheryl, Griffin, Alexa, Mike, Katie) are
 * hard-coded in index.html and are NOT stored here — their seats are
 * subtracted below.
 */
const CAPACITY = {
  "floater-gym": 1,
  "floater-craft": 1,
  tech: 1,
  fringe: 2,
  "first-aid": 1,
  greeters: 2,
  registration: 2,
  "sign-in": 1,
  "bball-ref": 1,
  "bball-score": 1,
  "vball-ref": 1,
  "vball-line": 2,
  "board-games": 1,
  "video-games": 1,
  crafts: 1,
  "food-team": 2
};

/** Seats already taken by pre-assigned leaders in index.html. */
const PRESET_TAKEN = {
  "floater-gym": 1, // Jonathon
  "floater-craft": 1, // Cheryl
  "bball-ref": 1, // Griffin
  "vball-ref": 1, // Alexa
  "board-games": 1, // Mike
  crafts: 1 // Katie
};

async function readAll() {
  const raw = await redis.hgetall(KEY);
  if (!raw) return [];
  return Object.entries(raw).map(([id, entry]) => {
    const v = typeof entry === "string" ? JSON.parse(entry) : entry;
    return { id, slotId: v.slotId, name: v.name };
  });
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, signups: await readAll() });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const action = body.action;

  try {
    if (action === "list") {
      return res.status(200).json({ ok: true, signups: await readAll() });
    }

    if (action === "claim") {
      const slotId = String(body.slotId || "");
      const name = String(body.name || "").trim();

      if (!CAPACITY.hasOwnProperty(slotId)) return res.status(200).json({ ok: false, error: "Unknown role" });
      if (name.length < 2) return res.status(200).json({ ok: false, error: "Name is required" });
      if (name.length > 60) return res.status(200).json({ ok: false, error: "Name is too long" });

      const all = await readAll();
      const here = all.filter((s) => s.slotId === slotId);

      const dupe = here.some((s) => s.name.trim().toLowerCase() === name.toLowerCase());
      if (dupe) return res.status(200).json({ ok: true, signups: all });

      const room = CAPACITY[slotId] - (PRESET_TAKEN[slotId] || 0);
      if (here.length >= room) return res.status(200).json({ ok: false, error: "That role just filled up" });

      const id = String(body.id || randomUUID());
      await redis.hset(KEY, { [id]: JSON.stringify({ slotId, name, timestamp: Date.now() }) });
      return res.status(200).json({ ok: true, signups: await readAll() });
    }

    if (action === "release") {
      const id = String(body.id || "");
      await redis.hdel(KEY, id);
      return res.status(200).json({ ok: true, signups: await readAll() });
    }

    return res.status(200).json({ ok: false, error: "Unknown action" });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String(err) });
  }
};
