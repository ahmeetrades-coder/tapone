// TapOne standalone server — runs the SAME actions module (./actions.ts)
// outside the Muse artifact runtime, on any Bun host (FadeHost, a VPS, …).
//
//   bun install
//   bun run build            # client -> client/dist/
//   bun run start            # this file
//
// Environment:
//   PORT           listen port (default 3000; FadeHost injects its own)
//   HOST           listen host (default 0.0.0.0)
//   DATABASE_PATH  SQLite file (default ./app.db; on FadeHost use
//                  /data/app.db so the database survives redeploys on the
//                  persistent disk — the app directory there is read-only)
//   CLIENT_DIR     static client build to serve (default ./client/dist)
//   SETTLE_TIME    daily contest settlement time "HH:MM" in SETTLE_TZ
//                  (default 00:15 America/Los_Angeles, matching space.json)
//
// Behaviour:
//   POST /actions { action, args }  — the exact envelope the built client
//     sends (see @hatch/space-sdk/client): 200 { data } on success,
//     non-2xx { error: { message, issues? } } on failure.
//   GET  /blobs/<key>               — files stored through ctx.blobs
//     (profile pictures), kept next to the database file.
//   GET  /theoremreach-callback?…   — TheoremReach's server-to-server
//     reward callback; dispatched to the theoremReachCallback action
//     with the raw signed URL so the action can verify the signature.
//   GET|POST /partner-callback/<key>?… — reward callback for any
//     partner the owner configured in Admin → Partner Callbacks;
//     dispatched to the partnerCallback action with every query
//     parameter verbatim (the saved config says which ones mean user
//     ID, transaction ID, payout and signature).
//   GET  /*                         — static files from CLIENT_DIR with an
//     index.html fallback (the app is a hash-routed single page).
//   Once a day at SETTLE_TIME it invokes the settleDailyContest action
//   in-process — the same job space.json schedules inside Muse.
//
// The ctx handed to the actions mirrors the runtime contract: ctx.db is a
// Drizzle accessor over bun:sqlite (the actions only use the portable
// select/insert/update/delete/run/all/get/batch surface), ctx.blobs is a
// directory on disk, ctx.invalidateQueries is a no-op (a standalone page
// refetches on its own), and agent/inference/tool calls throw — TapOne's
// actions never use them.

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { z, type BlobClient, type Ctx } from "@hatch/space-sdk";
import { Actions } from "./actions";
import * as schema from "./schema";

// ------------------------------------------------------------------ config

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10) || 3000;
const HOST = process.env.HOST ?? "0.0.0.0";
const DB_PATH = resolve(process.env.DATABASE_PATH ?? "app.db");
const CLIENT_DIR = resolve(process.env.CLIENT_DIR ?? "client/dist");
const BLOBS_DIR = `${DB_PATH}.blobs`;
const MIGRATIONS_DIR = resolve("drizzle");

// ------------------------------------------------------- database + migrate

mkdir(dirname(DB_PATH), { recursive: true });
const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

// Apply any drizzle/*.sql migration that has not run yet, in filename
// order. Applied files are tracked by name in a bookkeeping table the
// standalone server owns (the Muse runtime keeps its own journal in
// __drizzle_migrations; both record the same files, so a database copied
// from the live artifact is recognised as fully migrated by name).
function applyMigrations(): string[] {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS __standalone_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const done = new Set(
    sqlite
      .query("SELECT name FROM __standalone_migrations")
      .all()
      .map((r) => (r as { name: string }).name),
  );
  // A database copied from the Muse runtime already ran every migration
  // that existed then; its journal stores hashes, not names, so seed the
  // bookkeeping from the file list position: if __drizzle_migrations has
  // N rows, the first N migration files (in order) are already applied.
  const journal = sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get();
  const files = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR)
        .filter((f: string) => f.endsWith(".sql"))
        .sort()
    : [];
  if (journal) {
    const rows = sqlite.query("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as {
      n: number;
    };
    files.slice(0, rows.n).forEach((f: string) => done.add(f));
  }
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
    sqlite
      .query("INSERT INTO __standalone_migrations (name, applied_at) VALUES (?, ?)")
      .run(file, Date.now());
    applied.push(file);
  }
  return applied;
}

const newlyApplied = applyMigrations();
if (newlyApplied.length > 0) {
  console.log(`[tapone] applied migrations: ${newlyApplied.join(", ")}`);
}

const rawDb = drizzle(sqlite, { schema });

// The portable SpaceDb surface also includes `batch`, which the
// bun-sqlite driver does not implement: run the statements one by one
// inside a real SQLite transaction so a batch stays atomic.
async function batchImpl(statements: readonly unknown[]): Promise<unknown[]> {
  sqlite.exec("BEGIN");
  try {
    const results: unknown[] = [];
    for (const stmt of statements) results.push(await stmt);
    sqlite.exec("COMMIT");
    return results;
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
}

const db = new Proxy(rawDb, {
  get(target, prop) {
    if (prop === "batch") return batchImpl;
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

// ------------------------------------------------------------------- blobs

function blobFile(key: string): string {
  // Keys are server-generated (avatar_<userId>_<rand>.<ext>); hash anyway
  // so no key can ever escape the blobs directory.
  const digest = createHash("sha256").update(key).digest("hex");
  return join(BLOBS_DIR, digest);
}

const blobs: BlobClient = {
  async put(key, data, options) {
    await mkdir(BLOBS_DIR, { recursive: true });
    let bytes: Uint8Array;
    if (typeof data === "string") bytes = new TextEncoder().encode(data);
    else if (data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
    else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    await writeFile(blobFile(key), bytes);
    await writeFile(
      `${blobFile(key)}.meta.json`,
      JSON.stringify({
        key,
        contentType: options?.contentType ?? "application/octet-stream",
        public: options?.public ?? false,
      }),
    );
  },
  async getUrl(key) {
    return `/blobs/${encodeURIComponent(key)}`;
  },
  async delete(key) {
    await unlink(blobFile(key)).catch(() => {});
    await unlink(`${blobFile(key)}.meta.json`).catch(() => {});
  },
  async head(key) {
    try {
      const st = await stat(blobFile(key));
      const meta = JSON.parse(
        await readFile(`${blobFile(key)}.meta.json`, "utf8").catch(() => "{}"),
      ) as { contentType?: string; public?: boolean };
      return {
        key,
        contentType: meta.contentType ?? "application/octet-stream",
        size: st.size,
        sizeBytes: st.size,
        etag: createHash("sha256").update(key).digest("hex").slice(0, 16),
        visibility: meta.public ? "public" : "private",
        createdAtMs: Math.floor(st.birthtimeMs),
        updatedAtMs: Math.floor(st.mtimeMs),
        public: meta.public ?? false,
      };
    } catch {
      return null;
    }
  },
  async list(prefix) {
    if (!existsSync(BLOBS_DIR)) return [];
    const out = [];
    for (const name of await readdir(BLOBS_DIR)) {
      if (!name.endsWith(".meta.json")) continue;
      const meta = JSON.parse(await readFile(join(BLOBS_DIR, name), "utf8")) as {
        key: string;
      };
      if (prefix && !meta.key.startsWith(prefix)) continue;
      const m = await this.head(meta.key);
      if (m) out.push(m);
    }
    return out;
  },
};

// --------------------------------------------------------------------- ctx

function makeCtx(): Ctx {
  const unavailable = (what: string) => () => {
    throw new Error(`${what} is not available on the standalone server.`);
  };
  return {
    slug: "tapone-3",
    invocationId: globalThis.crypto.randomUUID(),
    spaceDir: process.cwd(),
    // The bun-sqlite Drizzle instance (plus the batch shim above) exposes
    // the same portable surface the SDK types.
    db: (() => db) as unknown as Ctx["db"],
    blobs,
    viewer: undefined,
    executePrivileged: unavailable("Privileged functions"),
    agent: {
      spawnTask: unavailable("Agent tasks"),
      send: unavailable("Agent tasks"),
      status: unavailable("Agent tasks"),
    } as Ctx["agent"],
    inference: { complete: unavailable("Inference") } as Ctx["inference"],
    tool: new Proxy(
      {},
      { get: () => unavailable("Tools") },
    ) as Ctx["tool"],
    emit: () => {},
    invalidateQueries: () => {},
  };
}

// ---------------------------------------------------------------- dispatch

type AnyAction = {
  request: z.ZodType;
  handler: (ctx: Ctx, args: never) => Promise<unknown>;
};
const actionTable = Actions as unknown as Record<string, AnyAction>;

async function dispatch(actionName: string, rawArgs: unknown): Promise<unknown> {
  const def = actionTable[actionName];
  if (!def) throw Object.assign(new Error(`Unknown action: ${actionName}`), { status: 404 });
  const parsed = def.request.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    throw Object.assign(new Error("Request did not match the action's fields."), {
      status: 400,
      issues: parsed.error.issues.map(
        (i: { path: PropertyKey[]; code: string; message: string }) => ({
          path: i.path,
          code: i.code,
          message: i.message,
        }),
      ),
    });
  }
  return await def.handler(makeCtx(), parsed.data as never);
}

function errorResponse(err: unknown): Response {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status: unknown }).status) || 500
      : 500;
  const issues =
    typeof err === "object" && err !== null && "issues" in err
      ? (err as { issues: unknown }).issues
      : undefined;
  const message =
    err instanceof Error ? err.message : "Something went wrong. Please try again.";
  if (status >= 500) console.error("[tapone] action error:", err);
  return Response.json(
    { error: { message, ...(issues ? { issues } : {}) } },
    { status },
  );
}

// ------------------------------------------------------------- static files

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",  
  ".xml": "application/xml; charset=utf-8",
};

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname.replace(/^\/+/, "");
  const filePath = resolve(CLIENT_DIR, rel === "" ? "index.html" : rel);
  if (filePath.startsWith(CLIENT_DIR) && existsSync(filePath)) {
    const st = await stat(filePath);
    if (st.isFile()) {
      const ext = filePath.slice(filePath.lastIndexOf("."));
      return new Response(Bun.file(filePath), {
        headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
      });
    }
  }
  // SEO files: serve the real sitemap.xml / robots.txt, never the SPA fallback. if (rel === "sitemap.xml" || rel === "robots.txt") { const sourcePath = join(process.cwd(), "client", rel); if (existsSync(sourcePath)) { const ext = sourcePath.slice(sourcePath.lastIndexOf(".")); return new Response(Bun.file(sourcePath), { headers: { "content-type": MIME[ext] ?? "application/octet-stream" } }); } return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } }); } // SPA fallback: every unknown path returns the app shell (hash routing).
  const indexPath = join(CLIENT_DIR, "index.html");
  if (existsSync(indexPath)) {
    return new Response(Bun.file(indexPath), {
      headers: { "content-type": MIME[".html"] ?? "text/html; charset=utf-8" },
    });
  }
  return new Response(
    "TapOne client is not built yet. Run `bun run build` first.",
    { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

// -------------------------------------------------------------------- main

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/actions" || url.pathname === "/actions/") {
      if (req.method !== "POST") {
        return Response.json(
          { error: { message: "Actions are called with POST." } },
          { status: 405 },
        );
      }
      let body: { action?: unknown; args?: unknown };
      try {
        body = (await req.json()) as { action?: unknown; args?: unknown };
      } catch {
        return Response.json(
          { error: { message: "Request body was not valid JSON." } },
          { status: 400 },
        );
      }
      if (typeof body.action !== "string") {
        return Response.json(
          { error: { message: "Request body must name an action." } },
          { status: 400 },
        );
      }
      try {
        const data = await dispatch(body.action, body.args);
        return Response.json({ data: data ?? null });
      } catch (err) {
        return errorResponse(err);
      }
    }
    if (url.pathname === "/theoremreach-callback") {
      // TheoremReach server-to-server reward callback (GET, query
      // params, &hash= signature appended last by TheoremReach). The
      // action verifies the HMAC-SHA1 signature over the exact URL
      // string, so pass it through untouched: signed_url is the raw
      // request URL with the trailing &hash=… removed.
      if (req.method !== "GET") {
        return Response.json(
          { error: { message: "Callback is called with GET." } },
          { status: 405 },
        );
      }
      const q = url.searchParams;
      const hash = q.get("hash") ?? undefined;
      let signedUrl: string | undefined;
      if (hash) {
        const suffix = `&hash=${hash}`;
        if (req.url.endsWith(suffix)) {
          signedUrl = req.url.slice(0, req.url.length - suffix.length);
        } else {
          const rebuilt = new URL(req.url);
          rebuilt.searchParams.delete("hash");
          signedUrl = rebuilt.toString();
        }
      }
      try {
        const data = await dispatch("theoremReachCallback", {
          user_id: q.get("user_id") ?? "",
          tx_id: q.get("tx_id") ?? "",
          reward: q.get("reward") ?? undefined,
          reward_amount_in_dollars:
            q.get("reward_amount_in_dollars") ?? undefined,
          external_transaction_id:
            q.get("external_transaction_id") ?? undefined,
          reversal: q.get("reversal") ?? undefined,
          hash,
          signed_url: signedUrl,
        });
        return Response.json(data ?? { status: "ok" });
      } catch (err) {
        return errorResponse(err);
      }
    }
    if (url.pathname.startsWith("/partner-callback/")) {
      // Owner-configured partner reward callback (Admin → Partner
      // Callbacks). The key is the last path segment; every query
      // parameter is passed through verbatim — the partner's saved
      // config decides which parameters carry the user ID, the
      // transaction ID, the payout and the secret/signature, and the
      // action verifies and credits. Partners call this with GET;
      // POST with the same query string works too.
      if (req.method !== "GET" && req.method !== "POST") {
        return Response.json(
          { error: { message: "Callback is called with GET." } },
          { status: 405 },
        );
      }
      const key = decodeURIComponent(
        url.pathname.slice("/partner-callback/".length).split("/")[0] ?? "",
      );
      const params: Record<string, string> = {};
      url.searchParams.forEach((value, name) => {
        params[name] = value;
      });
      try {
        const data = await dispatch("partnerCallback", { key, params });
        return Response.json(data ?? { status: "ok" });
      } catch (err) {
        return errorResponse(err);
      }
    }
    if (url.pathname.startsWith("/blobs/")) {
      const key = decodeURIComponent(url.pathname.slice("/blobs/".length));
      const file = Bun.file(blobFile(key));
      if (await file.exists()) {
        const meta = await blobs.head(key);
        return new Response(file, {
          headers: {
            "content-type": meta?.contentType ?? "application/octet-stream",
          },
        });
      }
      return new Response("Not found", { status: 404 });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    return serveStatic(url.pathname);
  },
});

console.log(
  `[tapone] listening on http://${HOST}:${server.port} — db: ${DB_PATH}, client: ${CLIENT_DIR}`,
);

// ------------------------------------------- daily contest settlement timer

// Same job space.json declares for the Muse runtime: settleDailyContest
// once a day at 00:15 America/Los_Angeles. It only RECORDS winners; the
// owner pays prizes from Admin → Contest Payouts.
const SETTLE_TIME = process.env.SETTLE_TIME ?? "00:15";
const SETTLE_TZ = process.env.SETTLE_TZ ?? "America/Los_Angeles";

function msUntilNextSettle(): number {
  const [h = 0, m = 15] = SETTLE_TIME.split(":").map(Number);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SETTLE_TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const curH = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const curM = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  let deltaMin = h * 60 + m - (curH * 60 + curM);
  if (deltaMin <= 0) deltaMin += 24 * 60;
  return deltaMin * 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

function scheduleSettle(): void {
  const ms = msUntilNextSettle();
  console.log(`[tapone] next contest settlement in ${Math.round(ms / 60000)} min`);
  setTimeout(async () => {
    try {
      const result = (await dispatch("settleDailyContest", {})) as {
        settledDays?: number;
      };
      console.log(
        `[tapone] settleDailyContest done (${result?.settledDays ?? 0} day(s) recorded)`,
      );
    } catch (err) {
      console.error("[tapone] settleDailyContest failed:", err);
    }
    scheduleSettle();
  }, ms);
}
scheduleSettle();
