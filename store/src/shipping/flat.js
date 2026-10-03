/**
 * v1 - flat rate. The only shipping strategy implemented.
 *
 * Configuration comes from D1 (`shipping_rates`), never from code, because the
 * rate is the client's decision and changes per client:
 *
 *   label            what the customer sees ("Standard shipping", "Express")
 *   description      a line of explanation shown under the label on Stripe's page
 *   amount_cents     the rate, in cents
 *   free_over_cents  optional threshold: at or above this order subtotal the
 *                    option is offered at 0. NULL means always charged
 *   applies_to       'all' | 'physical_only'
 *
 * THE PLACEHOLDER IS DELIBERATELY $1.00, not a plausible-looking $8.00. A rate
 * that is obviously wrong cannot go live by accident, and its description says
 * so on the customer's screen. Every value here has to be set by the client for
 * their own products and region - that is why it lives in D1 and not in code.
 *
 * "Order subtotal" means the whole cart (items + quantities, before shipping).
 * If a client wants the threshold measured against physical items only, that is
 * a one-line change here and worth confirming before shipping it.
 */
export async function flatStrategy({ rate, subtotalCents, hasPhysical }) {
  if (rate.applies_to === "physical_only" && !hasPhysical) {
    return null;
  }

  const freeOver = rate.free_over_cents;
  const qualifies = freeOver !== null && freeOver !== undefined && subtotalCents >= freeOver;

  return {
    label: rate.label,
    description: rate.description || undefined,
    amount_cents: qualifies ? 0 : rate.amount_cents,
  };
}
