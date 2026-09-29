/**
 * Stock holds.
 *
 * Two layers, and the split matters:
 *
 *   products.reserved        a counter, so the availability check can be ONE
 *                            atomic conditional UPDATE with no read-then-write
 *                            race
 *   stock_reservations       one row per held line, recording where the hold came
 *                            from and when it dies
 *
 * The rows are what make LAZY EXPIRY possible. If a `checkout.session.expired`
 * webhook never arrives, nothing sweeps and nothing leaks: the next availability
 * check ignores holds past their expires_at and subtracts only the live ones, so
 * the counter repairs itself the next time anyone asks. No cron, no scheduled
 * Worker, no sweeper process.
 */

/** Placeholders for an IN (?, ?, ...) list. */
function placeholders(count) {
  return Array.from({ length: count }, (_, index) => `?${index + 1}`).join(", ");
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Releases any holds past their expiry for the given slugs, and subtracts exactly
 * what was released from products.reserved. The two statements run in one D1
 * batch (a transaction) and in order, so the sum is taken before the rows are
 * marked expired.
 *
 * `reserved` is floored at 0: a counter must never go negative even if data is
 * inconsistent, because a negative counter would grant extra stock.
 */
export async function sweepExpiredReservations(env, slugs, now) {
  if (slugs.length === 0) return;

  const list = placeholders(slugs.length);
  const bound = [...slugs, now];

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE products
          SET reserved = MAX(0, reserved - COALESCE((
                SELECT SUM(r.quantity)
                  FROM stock_reservations r
                 WHERE r.slug = products.slug
                   AND r.status = 'active'
                   AND r.expires_at <= ?${slugs.length + 1}
              ), 0))
        WHERE slug IN (${list})`,
    ).bind(...bound),
    env.DB.prepare(
      `UPDATE stock_reservations
          SET status = 'expired'
        WHERE status = 'active'
          AND expires_at <= ?${slugs.length + 1}
          AND slug IN (${list})`,
    ).bind(...bound),
  ]);
}

/**
 * Atomically holds `quantity` of one physical product.
 * Returns true when the hold was taken; false when there was not enough
 * available. One statement, no read-then-write race.
 */
export async function reserveOne(env, reservationId, slug, quantity, expiresAt) {
  const result = await env.DB.prepare(
    `UPDATE products
        SET reserved = reserved + ?1
      WHERE slug = ?2
        AND type = 'physical'
        AND stock IS NOT NULL
        AND (stock - reserved) >= ?1`,
  )
    .bind(quantity, slug)
    .run();

  const changes = result?.meta?.changes ?? result?.changes ?? 0;
  if (!changes) return false;

  await env.DB.prepare(
    `INSERT INTO stock_reservations (reservation_id, slug, quantity, expires_at, status)
     VALUES (?1, ?2, ?3, ?4, 'active')
     ON CONFLICT(reservation_id, slug) DO UPDATE SET
       quantity = quantity + excluded.quantity,
       status = 'active',
       expires_at = excluded.expires_at`,
  )
    .bind(reservationId, slug, quantity, expiresAt)
    .run();

  return true;
}

/** How much is actually available for a slug, ignoring holds past their expiry. */
export async function availableFor(env, slug, now) {
  const row = await env.DB.prepare(
    `SELECT p.stock,
            (SELECT COALESCE(SUM(r.quantity), 0)
               FROM stock_reservations r
              WHERE r.slug = p.slug AND r.status = 'active' AND r.expires_at > ?2) AS held
       FROM products p
      WHERE p.slug = ?1`,
  )
    .bind(slug, now)
    .first();

  if (!row || row.stock === null) return null;
  return Math.max(0, row.stock - (row.held ?? 0));
}

/**
 * Gives back every live hold belonging to one reservation.
 * Used on `checkout.session.expired`, on a failed Stripe call, and as the
 * compensation path when a later line cannot be held.
 */
export async function releaseReservation(env, reservationId, status = "released") {
  const { results } = await env.DB.prepare(
    `SELECT slug, quantity FROM stock_reservations
      WHERE reservation_id = ?1 AND status = 'active'`,
  )
    .bind(reservationId)
    .all();

  if (results.length === 0) return [];

  const statements = [];
  for (const row of results) {
    statements.push(
      env.DB.prepare(
        `UPDATE products
            SET reserved = MAX(0, reserved - ?1)
          WHERE slug = ?2`,
      ).bind(row.quantity, row.slug),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE stock_reservations SET status = ?2
        WHERE reservation_id = ?1 AND status = 'active'`,
    ).bind(reservationId, status),
  );

  await env.DB.batch(statements);
  return results;
}

/** Marks the holds as consumed by a paid order. The counter moves in the webhook. */
export async function consumeReservation(env, reservationId) {
  await env.DB.prepare(
    `UPDATE stock_reservations SET status = 'consumed'
      WHERE reservation_id = ?1 AND status = 'active'`,
  )
    .bind(reservationId)
    .run();
}

/** Live holds for a reservation, used by the webhook to move stock correctly. */
export async function pendingReservationLines(env, reservationId) {
  const { results } = await env.DB.prepare(
    `SELECT slug, quantity FROM stock_reservations
      WHERE reservation_id = ?1 AND status = 'active'`,
  )
    .bind(reservationId)
    .all();
  return results;
}
