/**
 * demo-store-payments — the Stripe egress proxy for demo-store (Worker B).
 *
 * WHY THIS WORKER EXISTS (E-29)
 * -----------------------------
 * A Worker invoked on the store's custom domain (store.victoriawinter00.com)
 * cannot complete a TLS handshake to api.stripe.com — Cloudflare answers 525
 * before Stripe is ever reached. The same code succeeds when the invoking Worker
 * runs on a workers.dev hostname. A Worker cannot call its *own* workers.dev
 * hostname (522), so the hop has to be a SEPARATE Worker — this one.
 *
 *     store Worker (custom domain) -> this Worker (workers.dev) -> api.stripe.com
 *
 * THIS IS NOT A GENERIC PROXY. It exposes exactly two operations, each with a
 * fixed Stripe path. Someone who learns the shared secret still cannot make it
 * call anything but these two endpoints. Do not "generalise" it.
 *
 * ISOLATION. The Stripe secret key lives here and nowhere else. The store Worker
 * holds only the shared proxy secret, so leaking the store's config does not
 * leak the payment key.
 */

const STRIPE_API = "https://api.stripe.com";
const CREATE_SESSION_PATH = "/v1/checkout/sessions";
const GET_SESSION_PATH = "/v1/checkout/sessions/";

/** Stripe session ids look like `cs_test_...` / `cs_live_...`. Bounded before
    interpolation, so nothing unbounded is ever put in a URL path. */
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{1,200}$/;

/** Requests allowed per IP per window. Small on purpose: this is a payment hop. */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Hard cap on the forwarded create-session body. */
const MAX_BODY_BYTES = 64 * 1024;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status === undefined ? 200 : status,
    headers: JSON_HEADERS,
  });
}

/** An unauthenticated caller must learn nothing — 404, never 403. */
function notFound() {
  return new Response("Not found", { status: 404 });
}

/* ---------------------------------------------------------------------------
   Rate limiting.
   Zone WAF, rate limiting and bot rules do not apply to workers.dev, so this
   Worker enforces its own. D1 is strongly consistent; KV is not, and a burst
   could under-count, which is why the durable store is D1.
--------------------------------------------------------------------------- */

const memoryWindows = new Map();

/** Fallback used only when RATE_LIMIT_DB is not bound. Per-isolate, best-effort. */
function memoryRateLimited(ip, now) {
  const entry = memoryWindows.get(ip);
  if (entry && now - entry.start < RATE_LIMIT_WINDOW_MS) {
    if (entry.count >= RATE_LIMIT_MAX) return true;
    entry.count += 1;
    return false;
  }
  if (memoryWindows.size > 5000) memoryWindows.clear();
  memoryWindows.set(ip, { start: now, count: 1 });
  return false;
}

async function rateLimited(env, ip) {
  const now = Date.now();

  if (!env.RATE_LIMIT_DB) {
    console.warn("proxy: RATE_LIMIT_DB is not bound; using the per-isolate limit only");
    return memoryRateLimited(ip, now);
  }

  try {
    const row = await env.RATE_LIMIT_DB.prepare(
      "SELECT window_start, count FROM proxy_rate_limits WHERE ip = ?1",
    )
      .bind(ip)
      .first();

    if (row && now - row.window_start < RATE_LIMIT_WINDOW_MS) {
      if (row.count >= RATE_LIMIT_MAX) return true;
      await env.RATE_LIMIT_DB.prepare(
        "UPDATE proxy_rate_limits SET count = count + 1 WHERE ip = ?1",
      )
        .bind(ip)
        .run();
      return false;
    }

    await env.RATE_LIMIT_DB.prepare(
      "INSERT INTO proxy_rate_limits (ip, window_start, count) VALUES (?1, ?2, 1) " +
        "ON CONFLICT(ip) DO UPDATE SET window_start = ?2, count = 1",
    )
      .bind(ip, now)
      .run();
    return false;
  } catch {
    // The limiter's storage must never break checkout for everyone else.
    console.warn("proxy: rate limit store unavailable; per-isolate fallback used");
    return memoryRateLimited(ip, now);
  }
}

/* ---------------------------------------------------------------------------
   The two operations.
--------------------------------------------------------------------------- */

async function callStripe(env, operation, stripePath, options) {
  if (!env.STRIPE_SECRET_KEY) {
    console.error(`proxy: ${operation} blocked — no Stripe key configured`);
    return json(
      { error: "proxy_not_configured", message: "The payment proxy is not configured." },
      503,
    );
  }

  const headers = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (options.contentType) headers["content-type"] = options.contentType;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  let response;
  try {
    response = await fetch(STRIPE_API + stripePath, {
      method: options.method,
      headers,
      body: options.body,
    });
  } catch {
    console.error(`proxy: ${operation} upstream fetch failed`);
    return json(
      { error: "proxy_upstream_unreachable", message: "The payment provider could not be reached." },
      502,
    );
  }

  const text = await response.text();
  // Log the operation and the provider status ONLY — never the key, the request
  // body, or the session id.
  console.log(`proxy: ${operation} stripe_status=${response.status}`);

  try {
    JSON.parse(text);
  } catch {
    console.error(`proxy: ${operation} upstream returned a non-JSON body`);
    return json(
      { error: "proxy_upstream_error", message: "The payment provider returned an unexpected response." },
      502,
    );
  }

  // Pass the provider's status and JSON body through unchanged. Stripe's error
  // bodies are JSON, and the store Worker needs the real status to react.
  return new Response(text, { status: response.status, headers: JSON_HEADERS });
}

export default {
  async fetch(request, env) {
    // Authenticate first: an unauthenticated caller must not learn that this
    // Worker exists, let alone which operations it has.
    if (!env.PROXY_SECRET || request.headers.get("x-proxy-secret") !== env.PROXY_SECRET) {
      return notFound();
    }

    const url = new URL(request.url);
    const ip = request.headers.get("cf-connecting-ip") || "unknown";

    if (await rateLimited(env, ip)) {
      return json(
        { error: "rate_limited", message: "Too many requests. Please try again shortly." },
        429,
      );
    }

    if (url.pathname === "/create-session") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

      const body = await request.text();
      if (body.length > MAX_BODY_BYTES) {
        return json({ error: "payload_too_large", message: "That checkout request was too large." }, 413);
      }

      return callStripe(env, "create_session", CREATE_SESSION_PATH, {
        method: "POST",
        body,
        contentType: "application/x-www-form-urlencoded",
        idempotencyKey: request.headers.get("idempotency-key") || undefined,
      });
    }

    const sessionMatch = url.pathname.match(/^\/get-session\/([^/]+)\/?$/);
    if (sessionMatch) {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

      const sessionId = sessionMatch[1];
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return json({ error: "invalid_session_id", message: "That session id is not valid." }, 400);
      }

      return callStripe(env, "get_session", GET_SESSION_PATH + sessionId, { method: "GET" });
    }

    return notFound();
  },
};
