# Demo Store — Phase 1 scaffold

A small, client-owned store: **one Cloudflare Worker** serves both the static
storefront and the product API, backed by **D1** (data) and **R2** (images).
Single origin, so there is no CORS, no preflight, and no allowed-origin list.

This is the store demo — the first project in the `Victoriademos` repository, and
it lives in `store/`. It is **separate from the consulting site** and shares
nothing with it except the visual design language (same palette, cards, top bar,
and responsive layout, reimplemented in `public/css/store.css`).

## Phase 1 scope

In:

- public product list and product detail pages
- `GET /api/products` and `GET /api/products/:slug` reading from D1
- the full D1 schema (all tables and indexes) so later phases have a home
- a documented way to seed the 50 demo products from `demo-catalog.csv`

Deliberately **not** in this phase: Stripe, cart, checkout, webhooks, orders,
admin, image upload, deployment. No Stripe credentials are needed. Nothing is
deployed and no remote D1/R2 resource is created.

## Prerequisites

- Node.js 20+ (developed on 24) and npm
- No Cloudflare account is required for local development

## Run it locally

All commands run from `store/`:

```bash
npm install            # installs wrangler (dev dependency)

npm run db:schema      # create the tables in LOCAL D1
npm run db:seed        # load demo-catalog.csv into LOCAL D1 (50 products)

npm run dev            # start the Worker + storefront on http://127.0.0.1:8787
```

Then open <http://127.0.0.1:8787/>.

- Product list: <http://127.0.0.1:8787/>
- Product detail: <http://127.0.0.1:8787/product/demo-physical-01>
- Cart: <http://127.0.0.1:8787/cart>
- Success: <http://127.0.0.1:8787/success>
- API list: <http://127.0.0.1:8787/api/products>
- API detail: <http://127.0.0.1:8787/api/products/demo-digital-04>

`wrangler dev` uses local bindings by default, so `DB` (D1) and `IMAGES` (R2)
resolve to local storage under `.wrangler/` and nothing touches an account.

### Re-seeding and resetting

Seed is idempotent — running `npm run db:seed` again updates the existing rows
(`ON CONFLICT(slug) DO UPDATE`) and never creates duplicates. Product ids are
uuid v4 and stay stable after the first insert.

To wipe local state completely, delete the `.wrangler/` directory (or just
`.wrangler/state/v3/d1`) and run `npm run db:schema` and `npm run db:seed` again.

### How the seed works

`scripts/seed.mjs` parses `docs/demo-catalog.csv` (quoted fields included), writes
an idempotent SQL file to `scripts/.tmp/seed.sql`, and executes it with
`wrangler d1 execute demo-store-db --local`. It is **strict** — a row whose field
count does not match the header stops the import with the row number and the
expected/actual counts, rather than guessing which column the extra fields belong
to. It also validates the spec rules while parsing —

- `type` must be `physical`, `digital`, or `service`
- `price_cents` must be a non-negative integer
- `stock` must be **empty** for digital and service, and a non-negative integer
  for physical (NULL means "not stock-tracked", not zero)

— and exits with a clear error if a row breaks them.

## Cart (phase 2a)

The cart lives in `localStorage` under the key **`store-cart`**, and the stored
value is exactly:

```json
[{ "slug": "demo-physical-01", "quantity": 2 }]
```

**Prices are never stored.** Every read validates that value as untrusted input:
non-array data, entries that are not objects, non-slug `slug` values, and
quantities that are not integers of at least 1 are discarded; quantities above
99 are clamped. The cleaned list is written back, so bad data does not survive.

The cart page re-reads `GET /api/products` and computes the running total from
those server prices at render time. A slug that is no longer present or has gone
inactive is removed from the cart with a visible notice. Availability is shown
for information only — the server is the authority, and re-validates everything
at checkout.

## Checkout (phase 2b)

`POST /api/checkout` accepts `{ items: [{ slug, quantity }], request_id }`. The
Worker resolves **every** price and stock level from D1 and ignores anything
price-shaped in the request. Any unknown or inactive slug, any quantity that is
not a whole number between 1 and 99, and any over-stock physical item rejects
the **whole** request — nothing is ever partially fulfilled.

It then creates a Stripe Checkout session on the account behind
`STRIPE_SECRET_KEY` (a Worker secret; locally the file `store/.dev.vars`, which
is gitignored) using a plain `fetch` call — there is no `stripe` package in this
project. The response is `{ "url": "..." }` and nothing else.

- **Shipping is added only when the resolved cart contains a physical item.** A
  digital/service-only cart never carries a shipping line. See below.
- The resolved line items are attached to the session as **metadata** (chunked,
  because Stripe caps metadata values at 500 characters) so the Phase 3 webhook
  can rebuild the order without trusting the browser.
- An **idempotency key** is sent to Stripe, so a double-click cannot open two
  sessions.
- `success_url` and `cancel_url` are derived from the request's own origin, so
  local and deployed behave the same without a hardcoded host.

**No orders are recorded yet.** The success page says so plainly. Order creation
belongs to the Phase 3 webhook, which does not exist. Stock is **validated but not
reserved** at checkout: reserving belongs with the order, so an abandoned payment
page cannot silently consume inventory. Insufficient stock comes back as a
structured error naming the slug and the maximum available, which the cart uses to
adjust and notify the customer.

Nothing Stripe-related loads on any page. Hosted Checkout is a pure server-side
redirect: our pages contain no Stripe script, no publishable key, and no card
fields.

### Shipping — per client, configured in D1

Rates are **the client's decision and are set per client**. They live in the D1
`shipping_rates` table, not in code, so a rate can be changed without a redeploy.
The demo ships with two placeholder rows — Standard and Express — and **both are
deliberately set to an obviously wrong $1.00/$2.00**. That is on purpose: a rate
that looks plausible can be missed, and an obviously wrong one cannot go live by
accident. Their customer-visible description says the client must set the real
value.

| Column | Meaning |
|---|---|
| `label` | what the customer sees ("Standard shipping") |
| `description` | a line of explanation shown under the label on Stripe's page |
| `amount_cents` | the rate in cents — `100` = $1.00 (placeholder) |
| `free_over_cents` | optional: at or above this cart subtotal the option is free; `NULL` = always charged |
| `applies_to` | `all` or `physical_only` |
| `strategy` | which strategy computes the rate — only `flat` exists today |
| `active`, `sort_order` | on/off, and the order shown (Stripe accepts at most 5 options) |

Change the standard rate to $6.00:

```bash
npx wrangler d1 execute demo-store-db --local \
  --command "UPDATE shipping_rates SET amount_cents = 600 WHERE id = 'flat-standard';"
```

(On a deployed store the same SQL runs against the remote database, once a real
database id is in `wrangler.jsonc`.)

**Strategies** live in `src/shipping/`:

- `flat.js` — the only implemented strategy.
- `weight-band.js` — a reserved slot, deliberately **not wired up**. It sums
  `quantity × weight_g` over the physical lines and matches a band. There is no
  `weight_g` column and no `weight_bands` table, so nothing in D1 is driving it
  today; the file documents the intended shape, including the same $1.00
  placeholder convention.

**Distance / zone-based rates are not offered** (MVP-SPEC §11). Stripe collects
the shipping address *after* the session is created, so rating on destination
would depend on a Stripe preview feature or on adding a postcode step before
redirect — a dependency on unfinished vendor functionality in a client's revenue
path. Carrier-calculated rates are out of scope too.

`SHIPPING_COUNTRIES` in `src/index.js` is still a placeholder — the list of
countries a physical order may ship to is a business decision.

### `reserved` — present in the schema, unused until Phase 3

`products.reserved` exists (default 0) and is **not used by any code yet**. The
intended Phase 3 behaviour is `available = stock - reserved`, with units reserved
atomically when a session is created, released on `checkout.session.expired`,
converted to a sale on `checkout.session.completed`, sessions set to expire after
30 minutes, and lazy expiry ignoring stale holds so a missed webhook self-heals.
It is in the schema from the outset so it is designed in rather than added later
as a migration. **2b itself validates stock and reserves nothing.**

### Schema changes need a fresh local database

There is no migration runner. `schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so
editing a table does not alter an existing local database. After a schema change,
delete the local state and re-apply:

```bash
rmdir /s /q .wrangler\state\v3\d1
npm run db:schema
npm run db:seed
```

## Verifying Phase 1

```bash
# 50 products, and one physical item at stock 0 on purpose
npx wrangler d1 execute demo-store-db --local \
  --command "SELECT COUNT(*) AS total FROM products; SELECT type, COUNT(*) FROM products GROUP BY type; SELECT slug, stock FROM products WHERE type='physical' AND stock=0;"

# inactive products 404 (temporarily deactivate one, then restore)
npx wrangler d1 execute demo-store-db --local \
  --command "UPDATE products SET active=0 WHERE slug='demo-service-10';"
curl -i http://127.0.0.1:8787/api/products/demo-service-10   # -> 404
npx wrangler d1 execute demo-store-db --local \
  --command "UPDATE products SET active=1 WHERE slug='demo-service-10';"
```

The list endpoint never returns a raw stock number; physical products expose
`in_stock` as a boolean, and digital/service products are always available.

## Layout

```
store/
├─ schema.sql             D1 schema — tables and indexes, from docs/DATA-AND-API.md §1
├─ wrangler.jsonc         Worker + static assets + D1 + R2 bindings (local)
├─ package.json           dev/schema/seed scripts
├─ scripts/seed.mjs       docs/demo-catalog.csv -> local D1
├─ src/
│  ├─ index.js           Worker: product reads + POST /api/checkout
│  └─ shipping/          flat (implemented), weight-band + zone (reserved slots)
├─ public/
│  ├─ index.html          product list
│  ├─ product.html        product detail
│  ├─ cart.html           cart contents and running total
│  ├─ success.html        returns from Stripe Checkout (no order is recorded yet)
│  ├─ css/store.css       design tokens + storefront components
│  └─ js/
│     ├─ accessibility.js dark / colorblind toggles
│     ├─ cart.js          localStorage cart + cart page renderer
│     └─ store.js         fetch + render (textContent only, no innerHTML)
└─ docs/
   ├─ MVP-SPEC.md         authoritative spec
   ├─ DATA-AND-API.md     authoritative data model and endpoints
   ├─ PRICING-MODEL.md    pricing model
   ├─ LIABILITY-AND-CLOSING.md
   └─ demo-catalog.csv    50 demo products
```

## Notes and limits

- The `database_id` in `wrangler.jsonc` is a **placeholder for local use**; a real
  id is created at deploy time in a later phase.
- Product images are not part of Phase 1. `image_key` exists in the schema and is
  returned (currently `null`); the pages show a styled placeholder block instead.
- At least one physical product is seeded at `stock = 0` so the sold-out path is
  testable before a client sees the store.
