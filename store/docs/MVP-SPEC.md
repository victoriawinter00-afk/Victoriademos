# Custom Store - V1 (MVP) Specification

**Status:** draft for operator review
**Date:** 28 September 2026
**Author:** Manager / Architect (for Victoria Luna Consulting LLC)

This spec exists to stop the build from sprawling. It defines one narrow, safe, sellable thing. Everything not listed under **In scope** is out, and the exclusions are written to be copied straight into the client-facing listing.

---

## 1. What this is

A small, client-owned online store built on the client's own Cloudflare and Stripe accounts.

The client owns the domain, the hosting account, the payment account, and the data. The consultant builds, tests, documents, and hands over the keys. There is no platform subscription to the consultant and no platform the client cannot leave.

**This is not "Shopify."** It is a good store for a narrow kind of client, with its limits written down. Aiming at parity with Shopify means competing with a decade of other people's work on tax engines, fraud tooling, PCI compliance, and operations. Nobody wins that. Aiming at *"exactly right for a small catalog, honestly scoped"* is buildable, safe, and sellable.

---

## 2. Target client

A business that:

- sells **one to fifty products**, physical or digital
- has **one currency** and **one country of operation**
- ships at a **flat rate**, or doesn't ship at all
- does **not** need customer accounts, subscriptions, or multi-language
- wants to **own** the store rather than rent it
- is willing to pay a **maintenance retainer**, and understands why

If a prospect needs any of the things in Section 5, the answer is "no, or not yet" - and if they need them badly, refer them to a hosted platform. Saying no is part of the product.

---

## 3. In scope - V1

### Storefront
- Product list page
- Product detail page: images, description, price, stock status
- Cart held in `localStorage` (the same pattern as the consultation box on the current site)
- Cart summary with quantities and a running total
- **Checkout via Stripe Checkout** (Stripe's hosted page - see Section 6)
- Order confirmation page after returning from Stripe

### Payments
- **Stripe Checkout (hosted)** using the **client's own Stripe account**
- **Stripe Tax** enabled on the client's account for sales tax
- Stripe emails the customer their receipt (no custom receipt email needed)

### Orders
- Order created **only** by a verified Stripe webhook - never by the browser
- Order stored in D1 with line items, totals, customer email, and status
- Merchant notification email via Cloudflare Email Sending
- Order status: `paid`, `fulfilled`, `refunded` (refunds set in Stripe, reflected by webhook)

### Admin
- Behind **Cloudflare Access** (free tier) - no hand-rolled login
- Add / edit / delete products
- Upload product images to R2
- Set price and stock quantity
- View orders and change fulfilment status

### Handover
- Deployed to the **client's own Cloudflare account**
- Written documentation: how to add a product, fulfil an order, issue a refund
- Maintenance retainer offered and explained

---

## 4. Explicitly OUT of scope - copy this into the listing

> **What this build does not include.**
>
> Customer accounts and login. Discount codes and promotions. Subscriptions or recurring billing. Multi-currency. Multiple languages. Real-time inventory sync with any external system. Abandoned-cart recovery. Product reviews. Wishlists. Loyalty or referral programs. Gift cards. Marketplace or channel sync (Amazon, eBay, Etsy, social). Point of sale. B2B pricing or wholesale tiers. Custom tax rules beyond Stripe Tax. Uptime or response-time guarantees.
>
> **Shipping:** flat rates and weight-banded rates are supported. **Carrier-calculated live rates are not offered** - that requires package-packing logic, dimensional weight, multi-box splitting, and handling carrier API failures mid-checkout. See §13 for what shipping does and does not cover.
>
> If you need any of these, a hosted platform will serve you better, and I will say so.

That paragraph is the product's honesty. It is also what keeps the work bounded and the liability survivable.

---

## 5. Architecture

```
Customer browser
      │
      ▼
Cloudflare Pages        static storefront (HTML/CSS/JS)
      │
      ▼
Cloudflare Worker       API: products, cart->checkout, webhooks, admin
      │
      ├── D1            products, orders, order_items
      ├── R2            product images
      ├── Stripe        Checkout sessions, Tax, receipts, refunds
      └── Email Sending merchant notifications
```

- **Client's own Cloudflare account** and **client's own Stripe account.**
- Admin route protected by **Cloudflare Access**.
- **$5/month (Workers Paid) + Stripe fees**, paid by the client directly. Workers Paid is **required, not optional**, in this design: Cloudflare Email Sending - which carries the merchant notification - is only available on the paid plan. Pages and Worker request volumes for a small store would otherwise sit inside the free tier; Email Sending is what forces the upgrade.

---

## 6. Non-negotiable safety requirements

These are not features. They are the conditions that make the store safe to sell. Any one of them missing is a stop-the-build issue.

1. **Stripe secret key never reaches the browser.** It lives only as a Worker secret binding.
2. **Prices are looked up server-side.** The browser sends product IDs and quantities only. A price submitted by the browser is ignored, always.
3. **Orders are created from webhooks, not from the browser.** The confirmation page reads an order; it does not create one.
4. **Webhook signatures are verified** against the Stripe signing secret. Unsigned or mismatched requests are rejected.
5. **Order creation is idempotent.** Replaying the same Stripe event must not create a second order.
6. **No card data ever touches our systems.** Stripe Checkout handles all payment entry.
7. **Every order read is authorised.** Order IDs are never trusted from the client; access is by signed session or email-verified token.
8. **Admin is behind Cloudflare Access.** No custom password scheme.
9. **Quantities and stock are validated server-side** - no zero, negative, or over-stock orders.

**On PCI scope - small, but not zero.** Hosted Stripe Checkout keeps card data entirely off our systems, which places the merchant in **SAQ A**, the lightest self-assessment. Two consequences worth stating plainly:

- **The client, as merchant of record, still completes SAQ A** and remains responsible for their own PCI attestation. We do not remove that obligation; we keep it as small as it can be.
- **Never switch to an embedded card form.** Stripe Elements or any inline card field changes which SAQ applies and moves card data through the storefront. If a client ever asks for an on-page checkout, that is a scope change with a compliance consequence, not a styling preference.

---

## 7. Data entities (design level)

| Entity | Key fields |
|---|---|
| `products` | id, slug, name, description, price_cents, currency, stock, image_key, active, created_at |
| `orders` | id, stripe_session_id, stripe_payment_intent, email, total_cents, currency, status, created_at |
| `order_items` | id, order_id, product_id, name_snapshot, unit_price_cents, quantity |
| `processed_events` | stripe_event_id, processed_at - the idempotency guard |
| `admin_audit` | id, actor_email, action, target, created_at |

Notes:
- **Money is stored in integer cents.** Never floats.
- **Name and price are snapshotted onto the order item**, so later product edits don't rewrite history.
- Full DDL is the next document.

---

## 8. QA checklist - this is the operator's job, and it is the important one

Run every item before the store is shown to anyone. Each is a real failure mode, not a formality.

**Happy path**
- [ ] Browse product list, open a product, price and stock render correctly
- [ ] Add to cart, change quantity, remove item, total updates correctly
- [ ] Checkout with Stripe test card completes
- [ ] Order appears in D1 with the correct line items and total
- [ ] Confirmation page shows the right order
- [ ] Merchant notification email arrives

**Money path - the ones that matter**
- [ ] **Tamper with the checkout request** - send a fabricated price - confirm it is ignored
- [ ] Send quantity `0`, negative, and an absurdly large number - all rejected
- [ ] Attempt to buy more than stock - rejected
- [ ] **Replay the same Stripe webhook** - confirm exactly one order exists
- [ ] **Send a webhook with no/invalid signature** - rejected, nothing written
- [ ] **Change the order ID in the confirmation URL** - confirm another order cannot be read
- [ ] Refund in Stripe - confirm the order status updates and stock returns (if applicable)

**Access**
- [ ] Reach the admin URL without Cloudflare Access - denied
- [ ] Confirm no Stripe secret appears anywhere in the browser payloads or served JS

**Boundaries**
- [ ] Confirm every excluded feature from Section 4 is genuinely absent, not half-built

---

## 9. Build phases

| Phase | Deliverable | Gate to proceed |
|---|---|---|
| 1 | Static storefront + products read from D1 | Product list and detail render |
| 2 | Cart + Stripe Checkout session from the Worker | Test payment completes |
| 3 | Webhook + order recording + idempotency | Replay test passes |
| 4 | Admin behind Cloudflare Access | Access denial verified |
| 5 | Image upload to R2 | Upload and render verified |
| 6 | Full QA checklist (Section 8) | All boxes ticked |
| 7 | Demo content, screenshots, case study | Ready to show a prospect |

**Do not list the service publicly until Phase 6 passes.**

---

## 10. Decisions (resolved 28 Sep 2026)

1. **Product types - all three.** V1 supports **physical**, **digital**, and **service** products. Target catalog: **25 physical + 25 non-physical** (digital and service combined) = 50.

   This adds one subsystem and one checkout rule:
   - **physical** → requires shipping address, applies flat-rate shipping, tracks stock
   - **digital** → no shipping address, no stock, needs delivery
   - **service** → no shipping address, no stock, fulfilled manually

   **Rule:** shipping options are added to the Stripe Checkout session **only if the cart contains at least one physical item.** A digital-only cart must not be charged shipping.

   **Digital delivery - v1 is manual.** The merchant notification tells the owner which digital item was purchased and to whom; they send the file. Automatic signed download links from R2 are a v2 item. This keeps the first build bounded and removes a substitution/expiry/signed-URL subsystem.

2. **Product ceiling:** 50.

3. **Demo store:** name "Demo Store"; sells demo physical, digital, and service items.
   **Naming - decided:** literal placeholders with an encouraging tone. Pattern: `Demo [Type] NN - [short encouragement]`, e.g. `Demo Physical 01 - Your First Sale`. Every name states plainly that it is a demo, and the trailing phrase speaks kindly to a prospective founder rather than reading as a placeholder grunt.
   **Catalog written:** `demo-catalog.csv`, 50 products - 25 physical, 15 digital, 10 service. **One physical item is seeded at `stock = 0` deliberately**, so the sold-out path is testable before a client ever sees it.

4. **Where the demo lives:** **subdomain** - `store.victoriawinter00.com` - as a **separate Cloudflare project** with its own Pages, Worker, D1, and R2. Not a subpath of the consulting site: a subpath would require routing through the existing Pages project and puts the live site in the blast radius for no benefit.

5. **Storefront styling:** **built from the existing consulting site's design system**, not an external template. No verified off-the-shelf template exists for this exact stack, and third-party template licences often restrict resale - which matters because these builds are resold to clients. Reusing the existing components (cards, buttons, accessibility toggles, responsive layout) is free, matches the brand, and demonstrates our own work.

6. **Time box - set:** **20+ hours/week building, 20+ hours/week outreach**, with outreach continuing until the first paying client signs. Recorded as a standing commitment, not a suggestion.
   **Caution retained:** with no clients, the constraint is not capability but **lead generation**. The build hours produce the thing you sell; the outreach hours produce the revenue. If a week gets tight, protect the outreach and let the build slip.

---

## 11. Shipping

**Who decides:** the client. Shipping is **configured per client**, not fixed by the build. Rates live in data, not in code, so they can be changed without a redeploy.

**Implemented as a swappable strategy**, because the operator requires weight-based and distance-based options to remain available:

```
shipping/index.js        resolveShipping({ items, products, config, destination })
shipping/flat.js         v1 - implemented
shipping/weight-band.js  v2 - socket only
```

### v1 - flat rates (implemented)

Multiple options per client, up to Stripe's limit of five. Each has:
- `label` - e.g. "Standard shipping", "Express"
- `amount_cents`
- `free_over_cents` - optional threshold above which shipping is free
- `applies_to` - `all` or `physical_only`

### v2 - weight bands (socket only, achievable)

Fully compatible with hosted Checkout, because **the cart is known before the session is created**. Products gain `weight_g`; the strategy totals the cart weight, selects a band, and returns the rate. No new dependencies.

### Not offered - zones/distance and carrier-calculated rates

**Operator decision, 29 Sep 2026: neither is offered.** Recorded here with the reasoning so it is a considered position rather than a gap.

**Zones / distance-based rates.** Not offered. Two reasons, and the second is the one that decided it:

1. Stripe's `shipping_address_collection` collects the address **on Stripe's page, after the session exists** - so at session creation we do not know the destination and cannot rate by distance. Working around it means either asking for a ZIP on our own page before redirect, or moving to embedded Checkout and changing the PCI posture.
2. Rating on the entered address is supported by Stripe, but documented as a **preview feature**. Depending on unfinished vendor functionality for a client's revenue path is not something to build a product on.

**Carrier-calculated live rates (USPS / UPS / FedEx).** Not offered. Requires package-packing logic (how many boxes), dimensional weight, multi-box splitting, and handling carrier API failures mid-checkout. That is a subsystem in its own right, and it is precisely where the hosted platforms earn their subscription.

**Adding either later is a drop-in, not a rewrite.** `shipping/index.js` defines the interface; a new strategy is a new file. That is the whole point of the shape, and it costs nothing to keep the interface broad while offering only flat and weight-based rates.

## 12. What is deliberately not in this document

- The full D1 DDL - next artifact
- The Worker endpoint list - next artifact
- The service-agreement liability and closing checklist - next artifact, for attorney review
- The pricing model (one-time build + required maintenance retainer) - next artifact

---

## 13. Honest limits of this document

This spec was drafted with AI assistance and has not been reviewed by a software engineer or an attorney. The safety requirements in Section 6 are sound engineering practice, but **the money path has not been independently reviewed and should be**, before a client's money depends on it. The tax position relies entirely on Stripe Tax and on the client remaining the merchant of record - confirm that with the client's own accountant.

If any of this proves wrong in practice, the spec is the thing to change first, not the code.
