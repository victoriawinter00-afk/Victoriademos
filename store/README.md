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

Checkout is not part of this step. There is no payment code in the repository.

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
├─ src/index.js           Worker: GET /api/products, GET /api/products/:slug
├─ public/
│  ├─ index.html          product list
│  ├─ product.html        product detail
│  ├─ cart.html           cart contents and running total
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
