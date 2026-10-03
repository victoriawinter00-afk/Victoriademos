/**
 * Stripe webhook receiver.
 *
 * Handler order is fixed and identical for every request:
 *   1. read the RAW body (the signature covers exact bytes, so never parse first)
 *   2. verify the signature - on failure, 400, and do no work at all
 *   3. insert the event id into processed_events - a duplicate means 200 and stop
 *   4. do the work
 *   5. return 200
 *
 * If the work throws AFTER step 3, the processed_events row is removed and a 500
 * is returned, so Stripe's retry can still process the event. Without that
 * compensation a transient database error would permanently swallow an event
 * that had already been marked as handled.
 */

import {
  consumeReservation,
  pendingReservationLines,
  releaseReservation,
} from "./reservations.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Stripe's default replay tolerance. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verifies a Stripe `stripe-signature` header (`t=...,v1=...`) over the raw body.
 * The timestamp is checked against a tolerance window so a captured payload
 * cannot be replayed later, and the comparison is constant-time.
 */
export async function verifyStripeSignature(rawBody, header, secret, nowMs = Date.now()) {
  if (!header || !secret) return false;

  let timestamp = null;
  const signatures = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return false;

  const seconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(seconds)) return false;
  const skew = Math.abs(Math.floor(nowMs / 1000) - seconds);
  if (skew > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = toHex(mac);

  return signatures.some((signature) => constantTimeEquals(signature, expected));
}

/** Rebuilds the line items the Worker attached at session creation. */
function readLineItems(metadata) {
  if (!metadata) return [];
  const chunks = Number.parseInt(metadata.items_chunks ?? "0", 10);
  if (!Number.isFinite(chunks) || chunks <= 0) return [];

  let text = "";
  for (let index = 0; index < chunks; index += 1) {
    const chunk = metadata[`items_${index}`];
    if (typeof chunk !== "string") return [];
    text += chunk;
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Prefers whatever address Stripe actually collected, across API versions. */
function collectedAddress(session) {
  return (
    session?.collected_information?.shipping_details?.address ||
    session?.shipping_details?.address ||
    session?.customer_details?.address ||
    null
  );
}

/**
 * SEAM - merchant notification.
 * There is no Cloudflare Email Sending binding in this project and none has been
 * added: Email Sending needs a Workers Paid plan, and adding a binding here would
 * silently change the deployment requirements. This logs instead. Replace the
 * body with the real send when the binding exists.
 */
function notifyMerchant(order) {
  console.log(
    `order: merchant notification pending (not sent - no email binding) ` +
      `order=${order.id} total_cents=${order.total_cents} needs_attention=${order.needs_attention}`,
  );
}

/**
 * `checkout.session.completed` - the hold becomes a sale.
 * The order is written unconditionally: money has moved. If the stock cannot
 * actually cover it, the order is still recorded and flagged, never dropped.
 */
async function onSessionCompleted(env, session) {
  const metadata = session.metadata ?? {};
  const lines = readLineItems(metadata);
  if (lines.length === 0) {
    throw new Error(`session ${session.id} carried no usable line items`);
  }

  const needsShipping = metadata.needs_shipping === "true" ? 1 : 0;
  const orderId = crypto.randomUUID();

  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO orders
       (id, stripe_session_id, stripe_payment_intent, email, customer_name,
        subtotal_cents, shipping_cents, total_cents, currency, needs_shipping,
        shipping_address, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'paid', datetime('now'))`,
  )
    .bind(
      orderId,
      session.id,
      session.payment_intent ?? null,
      session.customer_details?.email ?? session.customer_email ?? "",
      session.customer_details?.name ?? null,
      session.amount_subtotal ?? 0,
      session.total_details?.amount_shipping ?? 0,
      session.amount_total ?? 0,
      session.currency ?? "usd",
      needsShipping,
      collectedAddress(session) ? JSON.stringify(collectedAddress(session)) : null,
    )
    .run();

  const insertedChanges = inserted?.meta?.changes ?? inserted?.changes ?? 0;
  if (!insertedChanges) {
    // Already recorded (same session id). Nothing further to do.
    console.log(`order: session ${session.id} was already recorded`);
    return;
  }

  // Snapshot the line items so later product edits never rewrite history.
  const itemStatements = lines.map((line) =>
    env.DB.prepare(
      `INSERT INTO order_items
         (id, order_id, product_id, slug_snapshot, name_snapshot, type_snapshot,
          unit_price_cents, quantity, created_at)
       VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, datetime('now'))`,
    ).bind(
      crypto.randomUUID(),
      orderId,
      line.s,
      line.n,
      line.t,
      line.u,
      line.q,
    ),
  );
  if (itemStatements.length > 0) await env.DB.batch(itemStatements);

  // Move stock for physical lines: the hold becomes a sale.
  let needsAttention = 0;
  for (const line of lines) {
    if (line.t !== "physical") continue;

    const product = await env.DB.prepare(
      `SELECT stock FROM products WHERE slug = ?1 AND type = 'physical'`,
    )
      .bind(line.s)
      .first();

    if (!product || product.stock === null || product.stock < line.q) {
      // Paid for something the shelf cannot cover. Recorded, flagged, not hidden.
      needsAttention = 1;
      console.error(
        `order: oversold - order=${orderId} slug=${line.s} requested=${line.q} on_hand=${
          product ? product.stock : "missing"
        }`,
      );
    }

    await env.DB.prepare(
      `UPDATE products
          SET stock = MAX(0, stock - ?1),
              reserved = MAX(0, reserved - ?1)
        WHERE slug = ?2 AND type = 'physical' AND stock IS NOT NULL`,
    )
      .bind(line.q, line.s)
      .run();
  }

  if (needsAttention) {
    await env.DB.prepare(`UPDATE orders SET needs_attention = 1 WHERE id = ?1`)
      .bind(orderId)
      .run();
  }

  if (metadata.reservation_id) {
    await consumeReservation(env, metadata.reservation_id);
  }

  notifyMerchant({
    id: orderId,
    total_cents: session.amount_total ?? 0,
    needs_attention: needsAttention,
  });
}

/** `checkout.session.expired` - give the hold back. */
async function onSessionExpired(env, session) {
  const reservationId = session?.metadata?.reservation_id;
  if (!reservationId) {
    console.log(`order: session ${session?.id} expired with no reservation to release`);
    return;
  }
  const released = await releaseReservation(env, reservationId, "released");
  console.log(
    `order: released ${released.length} held line(s) for expired session ${session.id}`,
  );
}

/** `charge.refunded` - put the stock back and mark the order. */
async function onChargeRefunded(env, charge) {
  const paymentIntent = charge?.payment_intent;
  if (!paymentIntent) return;

  const order = await env.DB.prepare(
    `SELECT id, status FROM orders WHERE stripe_payment_intent = ?1`,
  )
    .bind(paymentIntent)
    .first();

  if (!order) {
    console.log(`order: refund for unknown payment intent ${paymentIntent}`);
    return;
  }
  if (order.status === "refunded") {
    console.log(`order: ${order.id} was already refunded`);
    return;
  }

  await env.DB.prepare(`UPDATE orders SET status = 'refunded' WHERE id = ?1`)
    .bind(order.id)
    .run();

  const { results } = await env.DB.prepare(
    `SELECT slug_snapshot AS slug, quantity FROM order_items
      WHERE order_id = ?1 AND type_snapshot = 'physical'`,
  )
    .bind(order.id)
    .all();

  for (const line of results) {
    await env.DB.prepare(
      `UPDATE products SET stock = stock + ?1
        WHERE slug = ?2 AND type = 'physical' AND stock IS NOT NULL`,
    )
      .bind(line.quantity, line.slug)
      .run();
  }

  console.log(`order: ${order.id} refunded, ${results.length} physical line(s) returned to stock`);
}

/** POST /api/stripe/webhook */
export async function handleStripeWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  const verified = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!verified) {
    // No work happens on an unverified request. Nothing is written, nothing read.
    console.error("webhook: signature verification failed - request rejected");
    return json({ error: "invalid_signature" }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_payload" }, 400);
  }

  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    return json({ error: "invalid_payload" }, 400);
  }

  // Replay guard: the first delivery of an event id wins.
  const guard = await env.DB.prepare(
    `INSERT OR IGNORE INTO processed_events (stripe_event_id, type) VALUES (?1, ?2)`,
  )
    .bind(event.id, event.type)
    .run();

  const claimed = guard?.meta?.changes ?? guard?.changes ?? 0;
  if (!claimed) {
    return json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onSessionCompleted(env, event.data?.object ?? {});
        break;
      case "checkout.session.expired":
        await onSessionExpired(env, event.data?.object ?? {});
        break;
      case "charge.refunded":
        await onChargeRefunded(env, event.data?.object ?? {});
        break;
      default:
        // Never 500 on an event we do not handle: Stripe would retry forever.
        console.log(`webhook: ignoring unhandled event type ${event.type}`);
        break;
    }
  } catch (error) {
    // Release the claim so Stripe's retry is not swallowed as a duplicate.
    await env.DB.prepare(`DELETE FROM processed_events WHERE stripe_event_id = ?1`)
      .bind(event.id)
      .run();
    console.error(
      `webhook: ${event.type} failed - ${error && error.message ? error.message : "unknown"}`,
    );
    return json({ error: "processing_failed" }, 500);
  }

  return json({ received: true });
}

export { pendingReservationLines };
