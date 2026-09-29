# Data Model & API — Custom Store V1

**Status:** draft for operator review
**Date:** 28 September 2026
**Companion to:** `MVP-SPEC.md`
**Stack:** Cloudflare Pages (storefront) + Worker (API) + D1 (data) + R2 (images) + Stripe Checkout (hosted) + Email Sending (merchant notice)

---

## 0. Rules that constrain this design

These come from Section 6 of the spec. Every endpoint below is shaped by them.

1. Stripe secret key lives only as a Worker secret binding.
2. **Prices are never accepted from the browser.** The checkout request carries slugs and quantities only.
3. **Orders are created only by a verified webhook**, never by the storefront.
4. Webhook signatures are verified against the signing secret.
5. Order creation is idempotent.
6. No card data touches our systems — Stripe Checkout collects it.
7. Order reads are authorised by an unguessable token, never by a guessable ID.
8. Admin is behind Cloudflare Access.
9. Quantities and stock are validated server-side.

---

## 1. D1 schema

```sql
-- Products ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id            TEXT    PRIMARY KEY,           -- uuid v4
  slug          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  type          TEXT    NOT NULL CHECK (type IN ('physical','digital','service')),
  category      TEXT,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  currency      TEXT    NOT NULL DEFAULT 'usd',
  -- NULL for digital and service; integer for physical
  stock         INTEGER CHECK (stock IS NULL OR stock >= 0),
  image_key     TEXT,                          -- R2 object key
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Orders --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                    TEXT    PRIMARY KEY,   -- uuid v4
  stripe_session_id     TEXT    NOT NULL UNIQUE,
  stripe_payment_intent TEXT,
  email                 TEXT    NOT NULL,
  customer_name         TEXT,
  subtotal_cents        INTEGER NOT NULL,
  shipping_cents        INTEGER NOT NULL DEFAULT 0,
  total_cents           INTEGER NOT NULL,
  currency              TEXT    NOT NULL DEFAULT 'usd',
  needs_shipping        INTEGER NOT NULL DEFAULT 0 CHECK (needs_shipping IN (0,1)),
  shipping_address      TEXT,                  -- JSON blob, NULL when not required
  status                TEXT    NOT NULL DEFAULT 'paid'
                                CHECK (status IN ('paid','fulfilled','refunded','cancelled')),
  fulfilled_at          TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Order line items — snapshots, so later product edits never rewrite history --
CREATE TABLE IF NOT EXISTS order_items (
  id                TEXT    PRIMARY KEY,
  order_id          TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        TEXT,                      -- may point at a soft-deleted product
  slug_snapshot     TEXT    NOT NULL,
  name_snapshot     TEXT    NOT NULL,
  type_snapshot     TEXT    NOT NULL CHECK (type_snapshot IN ('physical','digital','service')),
  unit_price_cents  INTEGER NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Idempotency guard — one row per Stripe event processed ---------------------
CREATE TABLE IF NOT EXISTS processed_events (
  stripe_event_id TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  processed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin audit trail ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit (
  id          TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes -------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_active    ON products(active, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_slug      ON products(slug);
CREATE INDEX IF NOT EXISTS idx_orders_email       ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_created     ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order  ON order_items(order_id);
```

### Design notes

- **Money is integer cents, always.** No floats anywhere, at any layer.
- **`stock` is `NULL` for digital and service.** `NULL` means "not stock-tracked", not "zero". Don't conflate them — a `NULL` stock item is always purchasable.
- **Snapshots on `order_items`.** If the owner renames a product or changes its price next month, past orders must still show what was actually bought and for how much.
- **`processed_events` is the idempotency mechanism.** Insert the Stripe event ID *before* doing work; a duplicate insert fails and the handler exits. This is what makes webhook replays safe.
- **`needs_shipping`** is computed at order creation from the line items, so fulfilment knows at a glance whether a parcel is involved.
- **Soft delete only.** `active = 0`, never `DELETE FROM products` — orders reference them.
- **D1 free-tier ceilings.** 100,000 rows written per day, 5 million read, 5 GB stored. A small store will not approach these — orders are the only high-frequency write. But an unbounded backfill, a retry loop, or a webhook that writes on every delivery instead of once will. Keep writes proportional to orders, never to page views.

### Atomic stock decrement

D1 supports `batch()`. Do **not** read-then-write. Use a conditional update and check the affected row count:

```sql
UPDATE products
   SET stock = stock - ?1, updated_at = datetime('now')
 WHERE id = ?2
   AND type = 'physical'
   AND stock IS NOT NULL
   AND stock >= ?1;
```

If `changes === 0`, the item is not available — abort the whole checkout. This is what prevents overselling when two customers buy the last unit at once.

---

## 2. Worker endpoints

### Public — no authentication

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/products` | Active products. Returns **public fields only** — never `stock` as a raw number for physical items if you'd rather show "in stock / out of stock" only. |
| `GET` | `/api/products/:slug` | One active product. 404 if inactive. |
| `POST` | `/api/checkout` | Body: `{ items: [{ slug, quantity }] }`. Server looks up every price, validates stock, creates a Stripe Checkout session, returns `{ url }`. |
| `GET` | `/api/orders/:sessionId` | Returns the order matching a Stripe Checkout session ID. Used by the confirmation page. |
| `GET` | `/images/:key` | Streams a product image from R2 with cache headers. Keeps the bucket private. |

**`POST /api/checkout` — what it must do, in order:**
1. Reject if `items` is empty, missing, or not an array.
2. Reject any `quantity` that is not a positive integer within a sane ceiling.
3. Look up **every** product by slug. Any unknown or inactive slug → reject the whole request.
4. **Take prices from the database. Ignore anything price-like in the request body.**
5. Decrement stock atomically for physical items (Section 1). If any fails, abort all of it.
6. Compute `needs_shipping` from the resolved line items.
7. **Add a shipping option to the session only if `needs_shipping` is true.**
8. Create the Stripe Checkout session, attach `metadata` carrying the line items, and return only the redirect URL.

**`GET /api/orders/:sessionId` — authorisation.** The Stripe session ID *is* the bearer token. It is long, random, and unguessable, and Stripe puts it in the return URL as `?session_id={CHECKOUT_SESSION_ID}`. So the confirmation page can read the order without a login. **Never accept an order lookup by order ID or by email.**

**Treat the session ID as a credential, because that is what it is.** Three places it can leak, and what to do about each:

| Vector | Mitigation |
|---|---|
| Server logs | Never log the URL or the session ID. Log the order ID after lookup, not the token |
| Browser history and shared devices | Unavoidable for a redirect flow. Acceptable for a receipt; **not** acceptable for anything more sensitive |
| `Referer` header | Only leaks if the confirmation page loads a third-party resource. **This design loads none — keep it that way.** Adding an analytics script later would silently start leaking order tokens to that third party |

If the client ever needs order history or account-level access, that is a **different authorisation model** — emailed magic links or an account system — not a longer-lived session ID.

---

### Webhook — signature-verified, no user auth

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/stripe/webhook` | Verify signature, then handle events idempotently. |

**Events to handle:**

| Event | Action |
|---|---|
| `checkout.session.completed` | Create the order + line items. Send merchant notification. |
| `charge.refunded` / `refund.created` | Set order `status = 'refunded'`. Return stock for physical items. |
| anything else | Log and ignore. Never 500 on an unhandled event type — Stripe will retry forever. |

**Handler order of operations, every time:**
1. Read the **raw** body (not parsed JSON) — signature verification needs the exact bytes.
2. Verify the signature. Reject with 400 if invalid. **Do no work on an unverified request.**
3. Insert the event ID into `processed_events`. If that fails as a duplicate, return 200 and stop — this is the replay guard.
4. Do the work.
5. Return 200.

Idempotency must also survive **two different events for the same session** (Stripe can send more than one). Guard on `orders.stripe_session_id UNIQUE` as well as the event ID.

---

### Admin — behind Cloudflare Access

Cloudflare Access blocks unauthenticated requests **before** they reach the Worker, and injects a signed `Cf-Access-Jwt-Assertion` header. Read the verified email from it for the audit log. Do not build your own login.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/products` | All products, including inactive |
| `POST` | `/api/admin/products` | Create |
| `PATCH` | `/api/admin/products/:id` | Update name, description, price, stock, category, active, sort order |
| `POST` | `/api/admin/products/:id/image` | Upload to R2, set `image_key` |
| `DELETE` | `/api/admin/products/:id` | Soft delete (`active = 0`) — never a real delete |
| `GET` | `/api/admin/orders` | List with filters: status, date range, email |
| `GET` | `/api/admin/orders/:id` | Single order with line items |
| `PATCH` | `/api/admin/orders/:id` | Set `status = 'fulfilled'`, stamp `fulfilled_at` |
| `GET` | `/api/admin/audit` | Recent admin actions |

Every admin write appends to `admin_audit`: actor email, action, target, timestamp.

---

## 3. Build order

Each step is independently testable, which matters because verification is the operator's role.

| Step | Build | Prove it works by |
|---|---|---|
| 1 | D1 schema applied; `products` seeded from `demo-catalog.csv` | `SELECT COUNT(*)` = 50; product list renders |
| 2 | `GET /api/products` + `GET /api/products/:slug` | List and detail render; inactive product 404s |
| 3 | `POST /api/checkout` with server-side pricing | Test-card payment completes; **a tampered price is ignored** |
| 4 | Webhook + idempotency | **Replay the same event — exactly one order**; **unsigned request rejected** |
| 5 | `GET /api/orders/:sessionId` + confirmation page | Confirmation renders; **a different session ID cannot read this order** |
| 6 | Admin behind Access + product CRUD | **Unauthenticated admin request denied** |
| 7 | R2 image upload + `/images/:key` | Image persists across deploys |
| 8 | Full QA checklist (spec Section 8) | Every box ticked |

---

## 4. Demo catalog

The 50 products are in **`demo-catalog.csv`** in this folder, ready to import into D1.

Naming scheme, per the operator's decision — literal placeholders that read kindly to a prospective founder:

```
Demo Physical 01 — Your First Sale
Demo Digital 04 — Your Template Library
Demo Service 02 — The Consultation
```

Every name states plainly that it is a demo, and the trailing phrase is an encouragement rather than a placeholder grunt. **One physical item is seeded with `stock = 0` deliberately** — testing the sold-out path needs a sold-out product, and it's the sort of thing that only gets discovered in front of a client if it isn't built in.

---

## 5. Honest limits of this document

Drafted with AI assistance, not reviewed by a software engineer. The schema and endpoint shapes are conventional and the safety rules are standard practice, but **the money path has not been independently reviewed** and should be before a client's money depends on it. The specific areas worth a second pair of eyes: the webhook idempotency logic, the stock decrement, and the session-ID authorisation on the confirmation lookup.
