-- Custom Store V1 — D1 schema.
-- Source of truth: DATA-AND-API.md Section 1. Money is integer cents everywhere.
-- stock is NULL for digital and service products; NULL means "not stock-tracked".

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
  -- Units held by live checkout sessions. available = stock - reserved.
  -- Phase 3 owns the logic (reserve at session creation, release on
  -- checkout.session.expired, convert to a sale on checkout.session.completed,
  -- with lazy expiry as the backstop). The column exists from the outset so it
  -- is designed in rather than added later as a migration.
  reserved      INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
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

-- Shipping rate configuration (Phase 2b) -------------------------------------
-- Per-client, stored in D1 so rates change without a redeploy. Only the `flat`
-- strategy is implemented; `weight_band` and `zone` are reserved sockets — see
-- src/shipping/. Amounts are integer cents, like everything else.
CREATE TABLE IF NOT EXISTS shipping_rates (
  id              TEXT    PRIMARY KEY,
  label           TEXT    NOT NULL,
  description     TEXT,                        -- shown under the label on Stripe's page
  amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
  free_over_cents INTEGER CHECK (free_over_cents IS NULL OR free_over_cents >= 0),
  applies_to      TEXT    NOT NULL DEFAULT 'physical_only'
                          CHECK (applies_to IN ('all','physical_only')),
  strategy        TEXT    NOT NULL DEFAULT 'flat'
                          CHECK (strategy IN ('flat','weight_band')),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- PLACEHOLDER RATES — the amount is deliberately $1.00, not a plausible-looking
-- $8.00, so a store cannot go live with it by accident. Every value here must be
-- set by the client for their own products and region. The description says so on
-- the customer's screen.
INSERT OR IGNORE INTO shipping_rates
  (id, label, description, amount_cents, free_over_cents, applies_to, strategy, active, sort_order)
VALUES
  ('flat-standard', 'Standard shipping',
   'Placeholder rate. The client must set this for their own product and region.',
   100, NULL, 'physical_only', 'flat', 1, 0),
  ('flat-express',  'Express shipping',
   'Placeholder rate. The client must set this for their own product and region.',
   200, NULL, 'physical_only', 'flat', 1, 1);

-- Indexes -------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_active    ON products(active, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_slug      ON products(slug);
CREATE INDEX IF NOT EXISTS idx_orders_email       ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_created     ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order  ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_rates_active ON shipping_rates(active, sort_order);
