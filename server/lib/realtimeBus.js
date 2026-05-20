import { EventEmitter } from "node:events";

import pg from "pg";

import { getPool, resolveDatabaseUrl } from "../db/pool.js";

// Cross-process pub/sub for admin live updates.
//
// Why PostgreSQL LISTEN/NOTIFY: the admin and portal services run in separate
// Node containers (see docker-compose.prod.yml). A portal-side upload must
// reach the admin's SSE clients, so an in-process EventEmitter does not work.
// Postgres NOTIFY piggybacks on a connection we already have, is transactional
// (it fires on COMMIT, not on the publish call), and needs no extra runtime.
//
// Channel name is single (`admin_events`); the message payload carries the
// event type so we don't multiply channels. Payload size limit is 8000 bytes
// per Postgres — we keep payloads to {type, projectId, ...minimal scope}.

const CHANNEL = "admin_events";
const MAX_PAYLOAD_BYTES = 7500;

const localEmitter = new EventEmitter();
localEmitter.setMaxListeners(0); // SSE clients add a listener per connection.

let listenerClient = null;
let listenerStartPromise = null;

async function startListener(env) {
  if (listenerClient || listenerStartPromise) return listenerStartPromise;

  listenerStartPromise = (async () => {
    const databaseUrl = resolveDatabaseUrl(env);
    if (!databaseUrl) return;

    const client = new pg.Client({ connectionString: databaseUrl });
    client.on("error", (err) => {
      // Reset on error so the next subscribe() retries the connection rather
      // than silently dropping every future event.
      console.error("[realtime] LISTEN client error:", err?.message || err);
      listenerClient = null;
      listenerStartPromise = null;
    });
    client.on("notification", (msg) => {
      if (msg.channel !== CHANNEL) return;
      let payload = null;
      try {
        payload = JSON.parse(msg.payload || "{}");
      } catch {
        return;
      }
      localEmitter.emit("event", payload);
    });

    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listenerClient = client;
  })();

  return listenerStartPromise;
}

// Subscribe to live events. Returns an unsubscribe function.
// The PG listener is lazy-started on first subscriber so unit tests that
// never call this function don't open an extra DB connection.
export async function subscribeToAdminEvents(handler, { env = process.env } = {}) {
  if (typeof handler !== "function") {
    throw new TypeError("subscribeToAdminEvents handler must be a function");
  }
  await startListener(env);
  localEmitter.on("event", handler);
  return () => {
    localEmitter.off("event", handler);
  };
}

// Publish an event to every admin SSE client across all server processes.
//
// Fire-and-forget: failures are logged but don't bubble — losing a notify is
// at worst a missed UI refresh, never a data correctness issue (the admin
// "Actualiser" button is still there and the data on next render is fresh).
export async function publishAdminEvent(event) {
  if (!event || typeof event !== "object" || !event.type) return;
  const enriched = {
    ...event,
    at: new Date().toISOString(),
  };
  const json = JSON.stringify(enriched);
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) {
    console.warn(
      "[realtime] dropping oversized event payload",
      Buffer.byteLength(json, "utf8")
    );
    return;
  }
  try {
    await getPool().query("SELECT pg_notify($1, $2)", [CHANNEL, json]);
  } catch (error) {
    console.warn("[realtime] pg_notify failed:", error?.message || error);
  }
}

export async function shutdownRealtimeBus() {
  localEmitter.removeAllListeners("event");
  if (listenerClient) {
    try {
      await listenerClient.end();
    } catch {
      // best-effort shutdown
    }
    listenerClient = null;
  }
  listenerStartPromise = null;
}
