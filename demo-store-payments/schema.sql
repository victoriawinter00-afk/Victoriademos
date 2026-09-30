-- Worker B (demo-store-payments) storage.
--
-- A SEPARATE database on purpose: the payments proxy must not be able to read or
-- write the store's products, orders or reservations. It stores only its own
-- rate-limit windows.
--
-- Applied locally with:  npm run db:schema
-- Applied remotely with: npx wrangler d1 execute demo-store-payments-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS proxy_rate_limits (
  ip           TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
