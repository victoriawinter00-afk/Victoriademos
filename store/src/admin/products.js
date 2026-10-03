/**
 * Admin product endpoints.
 *
 * Deletion is SOFT: `active = 0`, never `DELETE FROM`. A product row is
 * referenced by order snapshots and by historical reporting, so removing the row
 * would break history to tidy a list.
 *
 * Every write in this file is batched with its audit row by auditStatement(), so
 * a write cannot commit without one.
 */

import { AUDIT_ACTIONS, auditStatement, changesOf } from "./audit.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TYPES = new Set(["physical", "digital", "service"]);
const MAX_TEXT = 5000;

const ADMIN_COLUMNS = `id, slug, name, description, type, category, price_cents, currency,
                       stock, reserved, image_key, active, sort_order, created_at, updated_at`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be a JSON object." };
    return { body };
  } catch {
    return { error: "Body must be JSON." };
  }
}

async function findProduct(env, slug) {
  return env.DB.prepare(`SELECT ${ADMIN_COLUMNS} FROM products WHERE slug = ?1`).bind(slug).first();
}

/** Field-level validation. `stock` is handled by the caller: it depends on type. */
function readFields(body, requireCore) {
  const value = {};
  const errors = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  if (requireCore) {
    if (typeof body.slug !== "string" || !SLUG_PATTERN.test(body.slug)) {
      errors.push("slug is required, lowercase, and made of a-z, 0-9 and dashes.");
    } else {
      value.slug = body.slug;
    }
  }

  if (requireCore || has("name")) {
    if (typeof body.name !== "string" || body.name.trim() === "") {
      errors.push("name is required.");
    } else if (body.name.length > 200) {
      errors.push("name must be 200 characters or fewer.");
    } else {
      value.name = body.name.trim();
    }
  }

  if (requireCore || has("type")) {
    if (typeof body.type !== "string" || !TYPES.has(body.type)) {
      errors.push("type must be physical, digital or service.");
    } else {
      value.type = body.type;
    }
  }

  if (requireCore || has("price_cents")) {
    if (!Number.isInteger(body.price_cents) || body.price_cents < 0) {
      errors.push("price_cents must be a non-negative whole number of cents.");
    } else {
      value.price_cents = body.price_cents;
    }
  }

  if (has("description")) {
    if (typeof body.description !== "string" || body.description.length > MAX_TEXT) {
      errors.push("description must be text of 5000 characters or fewer.");
    } else {
      value.description = body.description;
    }
  } else if (requireCore) {
    value.description = "";
  }

  if (has("category")) {
    if (body.category === null || body.category === "") value.category = null;
    else if (typeof body.category === "string" && body.category.length <= 200) value.category = body.category;
    else errors.push("category must be text, or null.");
  } else if (requireCore) {
    value.category = null;
  }

  if (has("currency")) {
    if (typeof body.currency !== "string" || !/^[a-z]{3}$/.test(body.currency)) {
      errors.push("currency must be a three-letter lowercase code.");
    } else {
      value.currency = body.currency;
    }
  } else if (requireCore) {
    value.currency = "usd";
  }

  if (has("image_key")) {
    if (body.image_key === null || body.image_key === "") value.image_key = null;
    else if (typeof body.image_key === "string" && body.image_key.length <= 300) value.image_key = body.image_key;
    else errors.push("image_key must be text or null.");
  } else if (requireCore) {
    value.image_key = null;
  }

  if (has("active")) {
    if (body.active === true) value.active = 1;
    else if (body.active === false) value.active = 0;
    else if (body.active === 0 || body.active === 1) value.active = body.active;
    else errors.push("active must be 0 or 1.");
  } else if (requireCore) {
    value.active = 1;
  }

  if (has("sort_order")) {
    if (!Number.isInteger(body.sort_order)) errors.push("sort_order must be a whole number.");
    else value.sort_order = body.sort_order;
  } else if (requireCore) {
    value.sort_order = 0;
  }

  return { value, errors, hasStock: has("stock") };
}

/** Stock is NULL for digital and service, a non-negative integer for physical. */
function stockProblem(type, stock) {
  if (type === "physical") {
    if (!Number.isInteger(stock) || stock < 0) {
      return "stock must be a whole number of zero or more for a physical product.";
    }
    return null;
  }
  if (stock !== null && stock !== undefined) {
    return "stock must be null for digital and service products.";
  }
  return null;
}

/** GET /api/admin/products - everything, including inactive. */
export async function listProducts(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${ADMIN_COLUMNS} FROM products ORDER BY sort_order ASC, name ASC`,
  ).all();
  return json({ products: results });
}

/** POST /api/admin/products */
export async function createProduct(request, env, actor) {
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: "invalid_request", message: parsed.error }, 400);
  const body = parsed.body;

  const { value, errors, hasStock } = readFields(body, true);
  const stock = hasStock ? body.stock : null;
  const problem = stockProblem(value.type, stock);
  if (problem) errors.push(problem);
  if (errors.length) return json({ error: "invalid_request", message: errors.join(" ") }, 400);

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO products
           (id, slug, name, description, type, category, price_cents, currency,
            stock, image_key, active, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, datetime('now'), datetime('now'))`,
      ).bind(
        crypto.randomUUID(),
        value.slug,
        value.name,
        value.description,
        value.type,
        value.category,
        value.price_cents,
        value.currency,
        stock,
        value.image_key,
        value.active,
        value.sort_order,
      ),
      auditStatement(env, { actor, action: AUDIT_ACTIONS.productCreate, target: value.slug }),
    ]);
  } catch (error) {
    const message = error && error.message ? error.message : "";
    if (/unique|constraint/i.test(message)) {
      return json({ error: "conflict", message: "A product with that slug already exists." }, 409);
    }
    console.error(`admin: product create failed - ${message}`);
    return json({ error: "server_error", message: "The product could not be created." }, 500);
  }

  return json({ product: await findProduct(env, value.slug) }, 201);
}

/** PATCH /api/admin/products/:slug */
export async function updateProduct(request, env, actor, slug) {
  const existing = await findProduct(env, slug);
  if (!existing) return json({ error: "not_found", message: "No product with that slug." }, 404);

  const parsed = await readJson(request);
  if (parsed.error) return json({ error: "invalid_request", message: parsed.error }, 400);
  const body = parsed.body;

  /* The slug is the product's public address and is referenced by order
     snapshots; changing it would silently break links and history, so it is
     rejected rather than quietly applied. */
  if (Object.prototype.hasOwnProperty.call(body, "slug") && body.slug !== slug) {
    return json(
      { error: "invalid_request", message: "The slug cannot be changed; it is the product's public address." },
      400,
    );
  }

  const { value, errors, hasStock } = readFields(body, false);

  const effectiveType = value.type ?? existing.type;
  let effectiveStock;
  if (hasStock) {
    effectiveStock = body.stock;
  } else if (value.type && value.type !== "physical") {
    effectiveStock = null; // leaving physical clears the count
  } else if (value.type === "physical" && existing.type !== "physical") {
    errors.push("stock must be supplied when changing a product to physical.");
    effectiveStock = existing.stock;
  } else {
    effectiveStock = existing.stock;
  }

  const problem = stockProblem(effectiveType, effectiveStock);
  if (problem) errors.push(problem);

  const fields = Object.keys(value);
  if (fields.length === 0 && !hasStock) {
    errors.push("No supported fields were supplied.");
  }
  if (errors.length) return json({ error: "invalid_request", message: errors.join(" ") }, 400);

  const assignments = [];
  const bindings = [];
  const set = (column, bound) => {
    assignments.push(`${column} = ?${bindings.length + 1}`);
    bindings.push(bound);
  };

  for (const field of fields) set(field, value[field]);
  if (hasStock || value.type) set("stock", effectiveStock);
  assignments.push("updated_at = datetime('now')");

  const updateStatement = env.DB.prepare(
    `UPDATE products SET ${assignments.join(", ")} WHERE slug = ?${bindings.length + 1}`,
  ).bind(...bindings, slug);

  await env.DB.batch([
    updateStatement,
    auditStatement(env, { actor, action: AUDIT_ACTIONS.productUpdate, target: slug }),
  ]);

  return json({ product: await findProduct(env, slug) });
}

/** DELETE /api/admin/products/:slug - soft delete, never a row deletion. */
export async function softDeleteProduct(env, actor, slug) {
  const existing = await findProduct(env, slug);
  if (!existing) return json({ error: "not_found", message: "No product with that slug." }, 404);

  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE products SET active = 0, updated_at = datetime('now') WHERE slug = ?1`,
    ).bind(slug),
    auditStatement(env, { actor, action: AUDIT_ACTIONS.productSoftDelete, target: slug }),
  ]);

  if (changesOf(results[0]) === 0) {
    return json({ error: "server_error", message: "The product could not be updated." }, 500);
  }

  return json({ product: await findProduct(env, slug), soft_deleted: true });
}
