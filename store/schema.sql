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
