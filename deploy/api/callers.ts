/**
 * Server-side caller log — the shared, durable record of every enrichment.
 *
 * Storage is Vercel Blob, one JSON blob per caller under `callers/<id>.json`.
 * One-blob-per-record (rather than a single log document) means two people
 * running lookups at the same time can never clobber each other's writes —
 * there is no read-modify-write cycle to race.
 *
 *   GET    /api/callers          → {callers: [...]} newest first, all users
 *   PUT    /api/callers  {caller} → upsert one record (id assigned if absent)
 *   DELETE /api/callers?id=…      → remove one record
 *   DELETE /api/callers?all=1     → clear the log
 *
 * Records contain residential addresses and property data about real people.
 * The store is private (no public blob URLs) and every route requires the
 * same ENRICH_TOKEN as the enrichment endpoints.
 */

import { put, list, del, get } from "@vercel/blob";

const PREFIX = "callers/";

function authorized(req: any): boolean {
  const token = process.env.ENRICH_TOKEN;
  if (!token) return true;
  const supplied = req.headers?.["x-enrich-token"] || req.query?.token;
  return supplied === token;
}

async function readAll(): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    cursor = page.hasMore ? page.cursor : undefined;
    const blobs = page.blobs.filter((b) => b.pathname.endsWith(".json"));
    // Private-store blobs have no publicly fetchable URL — read them through
    // the SDK, which signs the request with BLOB_READ_WRITE_TOKEN.
    const docs = await Promise.all(
      blobs.map(async (b) => {
        try {
          const r = await get(b.pathname, { access: "private" });
          if (!r || r.statusCode !== 200 || !r.stream) return null;
          return JSON.parse(await new Response(r.stream).text());
        } catch {
          return null;
        }
      })
    );
    out.push(...docs.filter(Boolean));
  } while (cursor);

  out.sort(
    (a, b) => new Date(b.enrichedAt || 0).getTime() - new Date(a.enrichedAt || 0).getTime()
  );
  return out;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorized(req)) {
    res.status(401).json({ error: "enrichment token required" });
    return;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(500).json({ error: "caller store not configured" });
    return;
  }

  try {
    if (req.method === "GET") {
      res.status(200).json({ callers: await readAll() });
      return;
    }

    if (req.method === "PUT") {
      const caller = req.body?.caller;
      if (!caller || typeof caller !== "object") {
        res.status(400).json({ error: "caller object required" });
        return;
      }
      const id = String(caller.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
      if (!id) {
        res.status(400).json({ error: "caller.id required" });
        return;
      }
      const record = { ...caller, id, updatedAt: new Date().toISOString() };
      await put(`${PREFIX}${id}.json`, JSON.stringify(record), {
        access: "private", // the store holds PII — no publicly readable blob URLs
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        // Blob content is CDN-cached by default (a month). For a log that is
        // read back immediately after every write, that serves stale records —
        // an updated caller would keep showing its previous address.
        cacheControlMaxAge: 0,
      });
      res.status(200).json({ ok: true, id, caller: record });
      return;
    }

    if (req.method === "DELETE") {
      if (req.query?.all === "1") {
        let cursor: string | undefined;
        let n = 0;
        do {
          const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
          cursor = page.hasMore ? page.cursor : undefined;
          if (page.blobs.length) {
            await del(page.blobs.map((b) => b.url));
            n += page.blobs.length;
          }
        } while (cursor);
        res.status(200).json({ ok: true, deleted: n });
        return;
      }
      const id = String(req.query?.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
      if (!id) {
        res.status(400).json({ error: "id required" });
        return;
      }
      const page = await list({ prefix: `${PREFIX}${id}.json`, limit: 1 });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url));
      res.status(200).json({ ok: true, deleted: page.blobs.length });
      return;
    }

    res.status(405).json({ error: "method not allowed" });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e).slice(0, 300) });
  }
}
