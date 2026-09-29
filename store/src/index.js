/**
 * Demo Store Worker.
 *
 * One Worker serves both the static storefront (bound as ASSETS) and the API,
 * so every request is same-origin and CORS never applies.
 *
 * Implemented:
 *   GET  /api/products          -> active products, public fields only
 *   GET  /api/products/:slug    -> one active product, 404 if unknown or inactive
 *   POST /api/checkout          -> Stripe Checkout session, returns only a URL
 *
 * Not implemented yet: webhook order creation, orders table writes, admin,
 * image upload. Orders arrive in Phase 3.
 *
 * Money is integer cents at every layer. Prices are always re-resolved from D1;
 * nothing price-shaped in a request body is ever read.
 */

import { resolveShipping } from "./shipping/index.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

// Columns read from D1 and mapped to a public shape. `stock` is selected so the
// mapper can derive availability, and is never returned to the client.
const SELECT_COLUMNS =
  "id, slug, name, description, type, category, price_cents, currency, stock, image_key";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sane ceiling on a single line, mirroring the cart's own limit.
const MAX_QUANTITY = 99;
// Ceiling on distinct lines in one checkout request.
const MAX_LINES = 50;

/* ---------------------------------------------------------------------------
   Shipping.
   Rates are NOT defined here. They are rows in the D1 `shipping_rates` table,
   because the rate is the client's decision and is set per client — see
   src/shipping/ for the strategies and store/README.md for where to change them.
   SHIPPING_COUNTRIES is the one remaining placeholder: the list of countries a
   physical order may ship to, which is a business decision, not a technical one.
--------------------------------------------------------------------------- */
const SHIPPING_COUNTRIES = ["US"];

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

/* --------------------------- Catalog endpoints ---------------------------- */

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

/* ------------------------------ Checkout ---------------------------------- */

/**
 * Validate the request shape. Returns either { items } (a Map of slug -> total
 * quantity) or { error } describing what was wrong. Nothing price-shaped in the
 * body is read, so a submitted price cannot influence anything.
 */
function parseCheckoutBody(body) {
  const rawItems = body && body.items;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: "`items` must be a non-empty array." };
  }
  if (rawItems.length > MAX_LINES) {
    return { error: `A cart may contain at most ${MAX_LINES} different items.` };
  }

  const items = new Map();

  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { error: "Each item must be an object with slug and quantity." };
    }

    const slug = entry.slug;
    const quantity = entry.quantity;

    if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
      return { error: "Each item needs a valid product slug." };
    }
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return {
        error: `The quantity for "${slug}" must be a whole number between 1 and ${MAX_QUANTITY}.`,
      };
    }

    const total = (items.get(slug) ?? 0) + quantity;
    if (total > MAX_QUANTITY) {
      return {
        error: `The quantity for "${slug}" must be a whole number between 1 and ${MAX_QUANTITY}.`,
      };
    }
    items.set(slug, total);
  }

  return { items };
}

/**
 * Stripe metadata values are capped at 500 characters, so the resolved line
 * items are stored as a chunked JSON string. Phase 3's webhook reads these back
 * instead of trusting anything the browser sent.
 */
function addLineItemMetadata(params, lines, needsShipping) {
  const compact = lines.map((line) => ({
    s: line.slug,
    n: line.name,
    t: line.type,
    u: line.price_cents,
    q: line.quantity,
  }));
  const text = JSON.stringify(compact);
  const size = 460;
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  chunks.forEach((chunk, index) => {
    params.set(`metadata[items_${index}]`, chunk);
  });
  params.set("metadata[items_chunks]", String(chunks.length));
  params.set("metadata[needs_shipping]", needsShipping ? "true" : "false");
}

/**
 * The idempotency key makes a double-click safe: the browser sends one stable
 * id per checkout attempt, so two rapid identical requests reach Stripe as one.
 */
function idempotencyKeyFor(requestId) {
  if (typeof requestId === "string" && REQUEST_ID_PATTERN.test(requestId)) {
    return `checkout-${requestId.toLowerCase()}`;
  }
  return `checkout-${crypto.randomUUID()}`;
}

/** POST /api/checkout — resolves everything from D1, returns only a URL. */
async function handleCheckout(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request", message: "The request body must be JSON." }, 400);
  }

  const parsed = parseCheckoutBody(body);
  if (parsed.error) {
    return json({ error: "invalid_request", message: parsed.error }, 400);
  }
  const wanted = parsed.items;

  // Resolve every product from the database. Unknown or inactive -> whole
  // request rejected; never partially fulfilled.
  const slugs = [...wanted.keys()];
  const placeholders = slugs.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await env.DB.prepare(
    `SELECT id, slug, name, type, price_cents, currency, stock, active
       FROM products
      WHERE slug IN (${placeholders})`,
  )
    .bind(...slugs)
    .all();

  const bySlug = new Map(results.map((row) => [row.slug, row]));

  const unavailable = slugs.filter((slug) => {
    const row = bySlug.get(slug);
    return !row || row.active !== 1;
  });
  if (unavailable.length > 0) {
    return json(
      {
        error: "unavailable",
        message: "Some items are no longer available. Remove them and try again.",
        items: unavailable.map((slug) => ({ slug })),
      },
      409,
    );
  }

  // Stock is validated, never reserved here. Reserving belongs with the order,
  // which is created by the verified webhook in Phase 3.
  const shortages = [];
  for (const slug of slugs) {
    const row = bySlug.get(slug);
    if (row.type !== "physical") continue;
    const available = row.stock === null ? 0 : row.stock;
    const requested = wanted.get(slug);
    if (available < requested) {
      shortages.push({ slug, requested, available });
    }
  }
  if (shortages.length > 0) {
    return json(
      {
        error: "insufficient_stock",
        message: "Some items do not have enough stock.",
        items: shortages,
      },
      409,
    );
  }

  const lines = slugs.map((slug) => {
    const row = bySlug.get(slug);
    return {
      slug: row.slug,
      name: row.name,
      type: row.type,
      price_cents: row.price_cents,
      currency: row.currency,
      quantity: wanted.get(slug),
    };
  });

  const currencies = new Set(lines.map((line) => line.currency));
  if (currencies.size !== 1) {
    return json(
      { error: "invalid_request", message: "This cart mixes currencies." },
      400,
    );
  }

  const currency = lines[0].currency;
  const needsShipping = lines.some((line) => line.type === "physical");
  const origin = new URL(request.url).origin;

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("customer_creation", "always");

  lines.forEach((line, index) => {
    params.set(`line_items[${index}][quantity]`, String(line.quantity));
    params.set(`line_items[${index}][price_data][currency]`, currency);
    params.set(`line_items[${index}][price_data][unit_amount]`, String(line.price_cents));
    params.set(`line_items[${index}][price_data][product_data][name]`, line.name.slice(0, 250));
  });

  // Shipping appears only when the resolved cart contains a physical item.
  // The rates come from D1, resolved through the strategy interface.
  if (needsShipping) {
    const { results: shippingConfig } = await env.DB.prepare(
      `SELECT id, label, amount_cents, free_over_cents, applies_to, strategy, active, sort_order
         FROM shipping_rates
        WHERE active = 1
        ORDER BY sort_order ASC`,
    ).all();

    let options;
    try {
      options = await resolveShipping({
        items: lines,
        products: bySlug,
        config: shippingConfig,
        // Stripe collects the address on its own page, after this point.
        destination: null,
      });
    } catch (error) {
      console.error(
        `checkout: shipping resolution failed — ${error && error.message ? error.message : "unknown"}`,
      );
      return json(
        {
          error: "shipping_unavailable",
          message: "Shipping could not be worked out for this cart.",
        },
        500,
      );
    }

    if (options.length === 0) {
      console.error("checkout: a physical cart has no active shipping rate configured");
      return json(
        {
          error: "shipping_unavailable",
          message: "Shipping is not configured for this store yet.",
        },
        500,
      );
    }

    options.forEach((option, index) => {
      params.set(`shipping_options[${index}][shipping_rate_data][type]`, "fixed_amount");
      params.set(
        `shipping_options[${index}][shipping_rate_data][fixed_amount][amount]`,
        String(option.amount_cents),
      );
      params.set(
        `shipping_options[${index}][shipping_rate_data][fixed_amount][currency]`,
        currency,
      );
      params.set(
        `shipping_options[${index}][shipping_rate_data][display_name]`,
        option.label.slice(0, 250),
      );
      if (option.description) {
        params.set(
          `shipping_options[${index}][shipping_rate_data][description]`,
          option.description.slice(0, 250),
        );
      }
    });

    SHIPPING_COUNTRIES.forEach((country, index) => {
      params.set(`shipping_address_collection[allowed_countries][${index}]`, country);
    });
  }

  addLineItemMetadata(params, lines, needsShipping);

  params.set("success_url", `${origin}/success?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${origin}/cart`);

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": idempotencyKeyFor(body.request_id),
    },
    body: params.toString(),
  });

  const session = await stripeResponse.json();

  if (!stripeResponse.ok) {
    // Log the provider's code for debugging; never surface internals or the key.
    const providerError = session && session.error ? session.error : {};
    console.error(
      `checkout: stripe error type=${providerError.type ?? "unknown"} code=${
        providerError.code ?? "unknown"
      }`,
    );
    return json(
      {
        error: "payment_provider_error",
        message: "The payment step could not be started. Please try again.",
      },
      502,
    );
  }

  if (!session || typeof session.url !== "string") {
    console.error("checkout: stripe response contained no redirect url");
    return json(
      {
        error: "payment_provider_error",
        message: "The payment step could not be started. Please try again.",
      },
      502,
    );
  }

  // Only the redirect URL leaves this Worker — never the session object.
  return json({ url: session.url });
}

/* --------------------------------- Router --------------------------------- */

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

    if (pathname === "/api/checkout" || pathname === "/api/checkout/") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      return handleCheckout(request, env);
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
    if (pathname === "/cart" || pathname === "/cart/") {
      return env.ASSETS.fetch(new URL("/cart.html", url).toString());
    }

    if (pathname === "/success" || pathname === "/success/") {
      return env.ASSETS.fetch(new URL("/success.html", url).toString());
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
