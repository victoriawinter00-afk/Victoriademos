/**
 * Admin order endpoints.
 *
 * Orders are read-mostly here: the only write is marking one fulfilled, and it
 * stamps `fulfilled_at` once. `needs_attention` is surfaced on every response
 * that carries orders, because it exists precisely for a human to act on - an
 * order that was paid for but could not be satisfied.
 */

import { AUDIT_ACTIONS, auditStatement, changesOf } from "./audit.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const STATUSES = new Set(["paid", "fulfilled", "refunded", "cancelled"]);
const MAX_LIMIT = 500;

const ORDER_COLUMNS = `id, stripe_session_id, stripe_payment_intent, email, customer_name,
                      subtotal_cents, shipping_cents, total_cents, currency, needs_shipping,
                      shipping_address, status, needs_attention, fulfilled_at, created_at`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** A bare date means the whole day, not midnight. */
function normaliseBound(value, edge) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return edge === "start" ? `${value} 00:00:00` : `${value} 23:59:59`;
  }
  return value;
}

async function findOrder(env, id) {
  return env.DB.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ?1`).bind(id).first();
}

async function orderWithItems(env, order) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug_snapshot AS slug, name_snapshot AS name, type_snapshot AS type,
            unit_price_cents, quantity, created_at
       FROM order_items
      WHERE order_id = ?1
      ORDER BY rowid ASC`,
  )
    .bind(order.id)
    .all();
  return { ...order, items: results };
}

/** GET /api/admin/orders */
export async function listOrders(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const email = url.searchParams.get("email");
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  const limitParameter = url.searchParams.get("limit");

  const where = [];
  const bindings = [];
  const add = (column, operator, value) => {
    bindings.push(value);
    where.push(`${column} ${operator} ?${bindings.length}`);
  };

  if (status) {
    if (!STATUSES.has(status)) {
      return json(
        { error: "invalid_request", message: "status must be paid, fulfilled, refunded or cancelled." },
        400,
      );
    }
    add("status", "=", status);
  }
  if (email) add("LOWER(email)", "=", email.toLowerCase());
  if (since) add("created_at", ">=", normaliseBound(since, "start"));
  if (until) add("created_at", "<=", normaliseBound(until, "end"));

  let limit = 100;
  if (limitParameter !== null) {
    const parsed = Number.parseInt(limitParameter, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return json(
        { error: "invalid_request", message: `limit must be a whole number between 1 and ${MAX_LIMIT}.` },
        400,
      );
    }
    limit = parsed;
  }

  const { results } = await env.DB.prepare(
    `SELECT ${ORDER_COLUMNS} FROM orders
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY created_at DESC, rowid DESC
      LIMIT ${limit}`,
  )
    .bind(...bindings)
    .all();

  const flag = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM orders WHERE needs_attention = 1`,
  ).first();

  return json({ orders: results, needs_attention: flag ? flag.n : 0, limit });
}

/** GET /api/admin/orders/:id */
export async function getOrder(env, id) {
  const order = await findOrder(env, id);
  if (!order) return json({ error: "not_found", message: "No order with that id." }, 404);
  return json({ order: await orderWithItems(env, order) });
}

/** PATCH /api/admin/orders/:id - the only write: mark fulfilled. */
export async function fulfilOrder(request, env, actor, id) {
  const order = await findOrder(env, id);
  if (!order) return json({ error: "not_found", message: "No order with that id." }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request", message: "Body must be JSON." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_request", message: "Body must be a JSON object." }, 400);
  }
  if (body.status !== "fulfilled") {
    return json(
      { error: "invalid_request", message: 'The only supported status change is "fulfilled".' },
      400,
    );
  }
  if (order.status === "refunded" || order.status === "cancelled") {
    return json(
      { error: "conflict", message: `An order that is ${order.status} cannot be fulfilled.` },
      409,
    );
  }

  /* COALESCE keeps the first fulfilment time if this is called twice, so a
     repeated call cannot quietly rewrite when the order was fulfilled. */
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE orders
          SET status = 'fulfilled',
              fulfilled_at = COALESCE(fulfilled_at, datetime('now'))
        WHERE id = ?1`,
    ).bind(id),
    auditStatement(env, { actor, action: AUDIT_ACTIONS.orderFulfil, target: id }),
  ]);

  if (changesOf(results[0]) === 0) {
    return json({ error: "server_error", message: "The order could not be updated." }, 500);
  }

  return json({ order: await orderWithItems(env, await findOrder(env, id)) });
}
