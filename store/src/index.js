/**
 * Demo Store — Phase 1 Worker.
 *
 * One Worker serves both the static storefront (bound as ASSETS) and the public
 * product API, so every request is same-origin and CORS never applies.
 *
 * Phase 1 implements exactly two data endpoints:
 *   GET /api/products          -> active products, public fields only
 *   GET /api/products/:slug    -> one active product, 404 if unknown or inactive
 *
 * Not in this phase: checkout, Stripe, webhooks, orders, admin, image upload.
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

// Columns read from D1 and mapped to a public shape. `stock` is selected so the
// mapper can derive availability, and is never returned to the client.
const SELECT_COLUMNS =
  "id, slug, name, description, type, category, price_cents, currency, stock, image_key";

/** JSON response helper. */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/**
 * Map a `products` row to the public API shape.
 * Physical items expose in_stock (boolean), never the raw stock count.
 * Digital and service items are always purchasable — stock is not tracked.
 */
function toPublicProduct(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    type: row.type,
    category: row.category ?? null,
    price_cents: row.price_cents,
    currency: row.currency,
    image_key: row.image_key ?? null,
    in_stock: row.type === "physical" ? row.stock !== null && row.stock > 0 : true,
  };
}

/** GET /api/products — every active product, in display order. */
async function listProducts(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${SELECT_COLUMNS}
       FROM products
      WHERE active = 1
      ORDER BY sort_order ASC, name ASC`,
  ).all();

  return json({ products: results.map(toPublicProduct) });
}

/** GET /api/products/:slug — one active product; 404 for unknown or inactive. */
async function getProduct(env, slug) {
  const row = await env.DB.prepare(
    `SELECT ${SELECT_COLUMNS}
       FROM products
      WHERE slug = ?1 AND active = 1`,
  )
    .bind(slug)
    .first();

  if (!row) {
    return json({ error: "Not found" }, 404);
  }

  return json({ product: toPublicProduct(row) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ---- API ---------------------------------------------------------------
    if (pathname === "/api/products" || pathname === "/api/products/") {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405);
      }
      return listProducts(env);
    }

    const productMatch = pathname.match(/^\/api\/products\/([^/]+)\/?$/);
    if (productMatch) {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405);
      }

      let slug;
      try {
        slug = decodeURIComponent(productMatch[1]);
      } catch {
        return json({ error: "Not found" }, 404);
      }

      return getProduct(env, slug);
    }

    // Unknown API route: JSON 404, never the storefront HTML.
    if (pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    // ---- Static storefront -------------------------------------------------
    // Cart page: the cart itself lives in localStorage and is drawn client-side.
    if (pathname === "/cart" || pathname === "/cart/") {
      return env.ASSETS.fetch(new URL("/cart.html", url).toString());
    }

    // Clean product URL -> the static detail page reads the slug from the path.
    if (pathname === "/product" || pathname === "/product/") {
      return Response.redirect(new URL("/", url).toString(), 302);
    }
    if (pathname.startsWith("/product/")) {
      return env.ASSETS.fetch(new URL("/product.html", url).toString());
    }

    // Everything else: static asset (index.html, css, js) or 404 from assets.
    return env.ASSETS.fetch(request);
  },
};
