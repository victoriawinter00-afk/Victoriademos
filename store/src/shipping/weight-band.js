/**
 * v2 slot — weight-band shipping. NOT IMPLEMENTED. Intentionally.
 *
 * This is fully achievable with what we already have, and it works inside
 * hosted Checkout, because the cart is known before the session exists:
 *
 *   1. add `weight_g` (integer grams) to the products table
 *   2. sum quantity * weight_g over the PHYSICAL lines only
 *   3. look the total up against a band table in D1, e.g.
 *        weight_bands(id, min_g, max_g, label, description, amount_cents, sort_order)
 *   4. return the first band where min_g <= total_g < max_g
 *
 * Bands follow the same convention as flat rates: the placeholder is
 * deliberately $1.00 and carries a visible description saying the client must set
 * the real value for their product and region. Nothing here is wired up yet —
 * there is no `weight_bands` table and no `weight_g` column, so no placeholder
 * row exists anywhere. This file is the socket, not the wiring.
 *
 * No destination is needed, so nothing about the Stripe flow has to change.
 *
 * Deliberately unfinished: choosing bands means choosing someone's prices, and
 * there is no client yet to choose them for.
 *
 * It THROWS rather than returning null on purpose. If a rate row is pointed at
 * this strategy before it exists, checkout must fail loudly — silently offering
 * no shipping would ship goods for free.
 */
export async function weightBandStrategy() {
  throw new Error("shipping strategy 'weight_band' is not implemented yet");
}
