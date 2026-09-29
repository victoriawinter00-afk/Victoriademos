/**
 * Shipping strategies.
 *
 * `resolveShipping` is the only entry point the Worker uses. It takes the
 * resolved cart, the per-client rate configuration from D1, and (when known) the
 * destination, and returns the options to hand to Stripe.
 *
 * WHAT WE KNOW, AND WHEN — this shapes the whole design:
 * Stripe collects the shipping address on ITS OWN page, AFTER the session has
 * been created. So `destination` is null when we build the session. A strategy
 * that needs the destination cannot run here, which is why distance/zone rating
 * is not offered (operator decision, MVP-SPEC §11) and is not a strategy file.
 *
 * STRIPE CONSTRAINTS THIS RESPECTS:
 *  - `shipping_options` are fixed amounts for the whole order; per-item rates are
 *    not possible
 *  - at most 5 options may be offered
 *
 * Adding a strategy: write a new file alongside these, register it in STRATEGIES,
 * and add its name to the CHECK constraint on shipping_rates.strategy. Nothing in
 * the Worker changes.
 */
import { flatStrategy } from "./flat.js";
import { weightBandStrategy } from "./weight-band.js";

export const MAX_SHIPPING_OPTIONS = 5;

const STRATEGIES = {
  flat: flatStrategy,
  weight_band: weightBandStrategy,
};

/**
 * @param {object} args
 * @param {Array<{slug:string,name:string,type:string,price_cents:number,quantity:number}>} args.items
 * @param {Map<string,object>} args.products  resolved product rows by slug
 * @param {Array<object>} args.config         active rows from shipping_rates
 * @param {object|null} args.destination      null at session creation
 * @returns {Promise<Array<{label:string,description:string|undefined,amount_cents:number}>>}
 */
export async function resolveShipping({ items, products, config, destination = null }) {
  const rates = (config || [])
    .filter((rate) => rate.active === 1)
    .sort((a, b) => a.sort_order - b.sort_order);

  const hasPhysical = items.some((item) => item.type === "physical");
  const subtotalCents = items.reduce(
    (sum, item) => sum + item.price_cents * item.quantity,
    0,
  );

  const options = [];

  for (const rate of rates) {
    if (options.length >= MAX_SHIPPING_OPTIONS) break;

    const strategy = STRATEGIES[rate.strategy];
    if (!strategy) {
      throw new Error(`Unknown shipping strategy "${rate.strategy}" on rate "${rate.id}".`);
    }

    const option = await strategy({
      rate,
      items,
      products,
      subtotalCents,
      hasPhysical,
      destination,
    });

    if (option) {
      options.push({
        label: option.label,
        description: option.description,
        amount_cents: option.amount_cents,
      });
    }
  }

  return options;
}
