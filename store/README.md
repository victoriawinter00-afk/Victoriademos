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

**Orders are recorded by the Phase 3 webhook**, not by this endpoint. Stock is
**held** (not reserved against `stock`) when the session is created — see below.

Nothing Stripe-related loads on any page. Hosted Checkout is a pure server-side
redirect: our pages contain no Stripe script, no publishable key, and no card
fields.

### How long a hold lasts — the stock-exposure dial

`CHECKOUT_SESSION_MINUTES` in `src/index.js` (default **30**, Stripe's minimum)
sets how long an unpaid session holds its units. **This is a stock-exposure
setting, not merely a user-experience choice:** raising it lengthens how long a
unit can be held by a checkout that may never be paid for. Stripe's own default
is 24 hours, which is far too long for limited inventory. 30 minutes is right for
the demo; a real client may reasonably prefer 60.

### Stock holds, and why a missed webhook is harmless

Two layers:

- `products.reserved` — a counter, so availability is one atomic conditional
  `UPDATE` with no read-then-write race. Two customers clicking at the same
  instant for the last unit: exactly one gets it, the other is told it is sold
  out **before paying**.
- `stock_reservations` — one row per held line, recording where the hold came
  from and when it dies.

The rows make **lazy expiry** possible. If a `checkout.session.expired` webhook
never arrives, nothing leaks: every availability check ignores holds past their
`expires_at` and subtracts only the live ones, so the counter repairs itself the
next time anyone asks. **No cron job, no scheduled Worker, no sweeper process.**

Availability is reported on this basis too — a physical product fully held by open
checkouts reads as out of stock in `GET /api/products`, not as in stock.

## Orders and the Stripe webhook (phase 3)

`POST /api/stripe/webhook` handles the provider's events. The order of work is
fixed and identical every time:

1. read the **raw** body (the signature covers exact bytes)
2. **verify the signature** — `400` on failure, and **no work at all** on an
   unverified request
3. insert the event id into `processed_events` — a duplicate returns `200` and
   stops (the replay guard)
4. do the work
5. return `200`

If the work throws after step 3, the claim is **removed** and a `500` is returned,
so the provider's retry is not swallowed as a duplicate. Without that
compensation a transient database error would permanently lose an event.

| Event | What happens |
|---|---|
| `checkout.session.completed` | `orders` + `order_items` are written **from the session metadata**, never from a browser; `stock` and `reserved` both drop by the quantity; the hold is marked consumed |
| `checkout.session.expired` | the hold is released (`reserved` drops, `stock` unchanged) |
| `charge.refunded` | the order is marked `refunded` and the stock is returned, **once** — a second refund event does not return it again |
| anything else | logged, `200`. Never `500` on an unhandled type, or the provider retries forever |

**A paid order is never dropped.** If the shelf cannot cover a paid order — the
last unit sold between checkout and payment — the order is still written and
`orders.needs_attention` is set to 1 so a human looks at it. An order that
vanishes because stock ran out is a customer who paid and got nothing, and nobody
finds out until they complain.

### The webhook secret

Local: `STRIPE_WEBHOOK_SECRET` in `store/.dev.vars` (gitignored). Any
`whsec_`-shaped value works locally, because **you sign your own test payloads
with it** — which exercises signature verification, the replay guard, and every
branch without the Stripe CLI or a Stripe account.

Production: the signing secret from the Stripe dashboard, stored as a Worker
secret. It is never committed and never pasted into a chat.

### Merchant notification — deliberately stubbed

`notifyMerchant()` in `src/webhook.js` logs instead of sending. There is **no
Cloudflare Email Sending binding in this project and none has been added**:
Email Sending requires a Workers Paid plan, and quietly adding the binding would
change the deployment requirements. The function is the marked seam.

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

### `reserved` and reservations

`products.reserved` is now live: units are held atomically when a checkout session
is created, released when it expires, and converted to a sale when it completes.
See **Orders and the Stripe webhook** above for the full lifecycle, and the
lazy-expiry explanation that removes the need for a cron job.

### Schema changes need a fresh local database

There is no migration runner. `schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so
editing a table does not alter an existing local database. After a schema change,
delete the local state and re-apply:

```bash
rmdir /s /q .wrangler\state\v3\d1
npm run db:schema
npm run db:seed
```

## Storefront controls (phase 2c)

**Category filters.** Four toggle buttons — All Products, Digital, Physical,
Service — above the grid. Digital/Physical/Service multi-select; the selected set
*is* the state and an empty set means All Products, so mutual exclusion holds by
construction rather than by bookkeeping. Unselecting the last specific type
reverts to All Products instead of leaving an empty grid. Filtering is
client-side (`/api/products` already returns everything) and the state is
**in-memory**, so it resets on navigation — which is exactly what makes "return to
store" land in the default layout.

The result count is written to a plain element on first render. The `aria-live`
region stays **empty on load** and is written only on a user-initiated change, so
it cannot interrupt a screen reader the moment the page opens.

**Add to cart from a card.** Every card carries an Add to cart control beside its
availability badge, styled the same, disabled for out-of-stock physical items. It
uses the same cart module as the product page, updates the nav count, and shows
`Added ✓` for about a second before reverting.

**Clearing the cart.** `StoreCart.clear()` runs **only** when the success page has
confirmed the order exists. It never runs on page load, so abandoning checkout and
coming back keeps the selection, and it does not run while an order is still being
confirmed.

## Order lookup

`GET /api/orders/:sessionId` returns the order for one Stripe Checkout session,
with line items read from the **order snapshot** rather than joined back to
`products`, so a later price change cannot rewrite what someone bought.

The **session id is the bearer token** — Stripe generates it, it is long and
unguessable, and Stripe returns it in the success URL. It is the only accepted
key: never an order id, never an email. It is never logged.

Three outcomes, because the redirect genuinely can beat the webhook:

| Response | Meaning |
|---|---|
| `200 {status:"recorded"}` | the order exists; the success page renders it and **clears the cart** |
| `202 {status:"pending"}` | the payment exists but the record has not landed; the page retries a few times, then explains honestly, and **keeps the cart** |
| `404` | no completed payment for that link; the page says so plainly and **keeps the cart** |

## Admin API (phase 4) — API only, no UI

### The security model

Cloudflare Access sits in front of the deployed hostname and injects a signed
`Cf-Access-Jwt-Assertion` header. **But this Worker also answers on a
`workers.dev` hostname, which Access does not cover unless it is configured for
it separately.** So "the header is present" is not evidence of anything — anyone
who finds that hostname can type a header by hand. Only the header's
**signature** is evidence, so the token is verified cryptographically.

Verification order, failing closed at every step: three segments → header parses →
**`alg` is exactly RS256** (so `none` and HS256 never reach key handling) → `kid`
present → JWKS fetched (cached 5 minutes) → RSA key with that `kid` → **signature
verifies** → `exp` (60 s skew) → `nbf` if present → **`aud` equals
`CF_ACCESS_AUD`** → `iss` equals `CF_ACCESS_TEAM_DOMAIN` → email present. A JWKS
fetch failure is an authentication failure, never a pass.

**Every unauthenticated `/api/admin/*` request returns 404, not 403.** A 403
confirms the route exists to someone not entitled to know that.

### Configuration

| Variable | Meaning |
|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | e.g. `https://yourteam.cloudflareaccess.com`. Serves the JWKS at `/cdn-cgi/access/certs`, and is also the expected `iss` |
| `CF_ACCESS_AUD` | the Access application's AUD tag |

Read from the environment, never hardcoded. Locally they live in `.dev.vars`
(gitignored); when deployed they are Worker configuration.

One variable does double duty — JWKS URL and issuer — precisely because
Cloudflare signs with `iss` equal to the team domain. That is what makes the
whole verification path locally testable: point `CF_ACCESS_TEAM_DOMAIN` at a
local JWKS server and the real code runs unchanged. **There is no local bypass in
the code, and none was needed.**

### Endpoints

| Endpoint | Behaviour |
|---|---|
| `GET /api/admin/products` | every product, including inactive |
| `POST /api/admin/products` | create. Validates slug, type, integer cents, and that `stock` is NULL for non-physical |
| `PATCH /api/admin/products/:slug` | partial update. The slug cannot be changed (it is the public address), and changing a product away from physical clears `stock` |
| `DELETE /api/admin/products/:slug` | **soft delete** — `active = 0`. The row is never deleted, because order snapshots reference it |
| `GET /api/admin/orders` | filters `status`, `email`, `since`, `until`, `limit` (max 500); returns a `needs_attention` count |
| `GET /api/admin/orders/:id` | the order with its line-item snapshots |
| `PATCH /api/admin/orders/:id` | `{ "status": "fulfilled" }` sets the status and stamps `fulfilled_at` once — repeating it does not move the timestamp |

### Audit

Every admin **write** appends to `admin_audit` with the actor email taken from the
**verified** token. The write and its audit row are placed in **one D1 batch**,
which is transactional, so a write cannot commit without its audit row and a
rejected write leaves none. This is enforced by construction rather than by
remembering.

### Not built here

- **No admin UI** — deliberately API only.
- **Image upload to R2 is phase 4e** and is separate.
- **Nothing clears `needs_attention` yet** — it is surfaced, not dismissible.
- Whether Access blocks an unauthenticated request **at the edge** can only be
  verified against a deployed route.

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
│  ├─ index.js           Worker: product reads, POST /api/checkout, webhook route
│  ├─ webhook.js         Stripe signature verification + order handlers
│  ├─ reservations.js    atomic stock holds and lazy expiry
│  └─ shipping/          flat (implemented), weight-band (reserved slot)
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
