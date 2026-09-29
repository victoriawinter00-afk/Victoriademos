# Pricing Model — Custom Store V1

**Status:** draft for operator review
**Date:** 28 September 2026
**Companion to:** `MVP-SPEC.md`, `DATA-AND-API.md`

---

## 0. Read this before the numbers

**Published 2026 pricing guides disagree with each other by a factor of five or more.** One 2026 analysis comparing two major surveys found them **5.4× apart** on the same question (what a basic site costs) and **7.6× apart** on monthly retainers — and neither was wrong, because they were measuring different things.

So the numbers below are **anchors, not answers**. They tell you what the market tolerates. What actually sets your price is **your hours × your rate**, and that is unknowable until the demo is built. Treat everything here as a starting position to be corrected by measurement.

---

## 1. What the market charges — 2026 anchors

### Custom store builds

| Source | Range cited |
|---|---|
| Osdire (2026) | Basic template store **$500–$3,000**; branded store with custom pages and integrations **$3,000–$15,000**; **small custom store $5,000–$15,000+**; mid-range $20,000–$30,000+ |
| webcostly (2026) | Standard e-commerce **$4,000–$15,000**; WooCommerce **$4,000–$20,000**; custom platforms **$15,000–$100,000+** |
| hammanitech (2026) | Small e-commerce store **$5,000–$15,000** |
| galaxywing (2026) | E-commerce **$5,000–$50,000+**; custom web application **$25,000–$100,000+** |
| Clutch (2026) | Average e-commerce project **$51,943**; listed firms charge **$25–$49/hr** |

**The consistent band for a small custom store is roughly $5,000–$15,000.**

### Freelance hourly rates

| Source | Rate |
|---|---|
| galaxywing (2026) | Freelance web designer **$50–$150/hr** |
| venbit (2026) | Freelance maintenance **$50–$150/hr**; e-commerce or custom code **$100–$150/hr** |
| Clutch (2026) | E-commerce development firms **$25–$49/hr** |

**Your published rate is $100/hr. That sits mid-market and is defensible.** Do not discount it.

### Maintenance retainers

| Source | Range cited |
|---|---|
| WebFX (2026) | Small business site **$125–$500/mo**; **web application $300–$2,500/mo** |
| GoDaddy, via ueni (2026) | Small business **$50–$500/mo**; **e-commerce sites $300–$1,000/mo** |
| tuesday.is (2026) | Quality SMB care plan **$199–$599/mo** |
| venbit (2026) | Freelance retainer **$50–$300/mo**; e-commerce/custom code **$200–$300+/mo** |
| projectcostestimator (2026) | E-commerce maintenance **$4,000–$14,000/yr** (~$333–$1,167/mo) |
| GoodFirms (2026) | Agency retainers **$500–$3,000/mo** |

**The critical distinction: your store is not a website, it is an application.**

A brochure site is patched and forgotten. A custom store holds payment logic, a database, and Stripe integrations that change. **WebFX prices web applications at $300–$2,500/mo for exactly this reason.** Pricing your store retainer like a brochure site retainer is the mistake that turns maintenance into unpaid work.

---

## 2. Recommended pricing

### Build

| Tier | Price | Scope |
|---|---|---|
| **Starter** | **$4,500** | Up to **25 products**, one product type, flat-rate shipping, Stripe Checkout, admin panel, 30 days post-launch support |
| **Standard** | **$6,500** | Up to **50 products**, all three product types, categories, Stripe Checkout, admin, 60 days post-launch support |
| **Beyond scope** | **$100/hr** | Or a written change order, quoted before work begins |

**Why these numbers and not $2,000/$3,500** (the removed platform tiers): those prices were for *configuring someone else's platform*, which is far less work. A custom build involves schema design, payment logic, webhook handling, an admin interface, and testing. The market band for that work starts at $5,000. Pricing at $2,000 would mean losing money on every build and signalling inexperience.

**Why below the market band rather than inside it:** you have no portfolio yet. $4,500–$6,500 sits just under the $5,000–$15,000 band — honest for a newcomer, and not so low that it reads as a red flag.

**Raise them after your first two or three builds**, once you know your real hours. State the reason to early clients and put a limit on it: *"founding-client rate for the first three builds."*

### Maintenance — required, not optional

A custom store without maintenance is a liability with no revenue attached. **Make the retainer a condition of the build**, written into the agreement.

| Plan | Monthly | Includes |
|---|---|---|
| **Care** | **$200/mo** | Infrastructure monitoring, security and dependency patching, backup verification, uptime alerts, **2 hours** of fixes or changes, email support |
| **Care Plus** | **$400/mo** | Everything above with **4 hours** |
| **Care Pro** | **$700/mo** | Everything above with **7 hours** |

Hours beyond the included block are billed at **$100/hr** — your published rate, unchanged.

The included hours are priced at exactly your hourly rate, so the plan is transparent rather than padded: 2 hours × $100 = $200. A client who uses none of the hours is buying monitoring and patching, which is the part that actually prevents the expensive failures.

**Which plan to sell:** Care for a small catalog with no regular changes; Care Plus for a store the owner updates regularly; Care Pro only if they add features monthly.

### How to sell it, so it isn't refused

Do not present the retainer as an optional line item the client can decline, and **do not offer a "no retainer, higher build price" alternative.** That trades one problem for a worse one: the store decays, the client still calls you, and there is no revenue attached to the work.

1. **Sell the store as a maintained store.** The care plan is part of what the product *is* — the way a warranty is part of a purchase, not an add-on beside it. The listing and the proposal describe a maintained store, not a build plus a subscription.
2. **Include the first 90 days at no extra charge.** The client experiences patching, monitoring, and fixes before paying for them, and the move to billing reads as continuity rather than a new charge arriving after the invoice.
3. **If a client refuses outright, transfer the risk — do not discount it.** Two acceptable outcomes, both honest:
   - **Documented handover with a written assumption of maintenance.** They take the code, accept responsibility for its security and upkeep in writing, and you are explicitly released from support. The store leaves your care with the risk acknowledged rather than hidden.
   - **Refer them to a hosted platform.** If someone wants a custom store without maintaining it, a platform genuinely suits them better — and saying so protects the relationship instead of straining it.
4. **Never sell an unmaintained custom store at any price.** No build fee compensates for a store decaying under your name.

---

## 3. Payment structure

- **50% at engagement start**, remainder on delivery — matching your existing Custom Web Application terms.
- **Maintenance begins the month after launch** and bills monthly in advance.
- **Third-party fees are the client's, paid directly:** their domain, their Cloudflare account (~$5/month if Workers Paid is needed), their Stripe account (card fees), any Stripe Tax charges.

---

## 4. The comparison you must not get wrong

Do **not** pitch this as cheaper than Shopify. It usually isn't, and a client who checks will find out.

| | Shopify (Basic) | Custom V1 + Care |
|---|---|---|
| Upfront | $500–$3,000 (template setup) | **$4,500–$6,500** (build) |
| Monthly | $39 platform | **$200 care** |
| 36 monthly payments | 36 × $39 = **$1,404** | 36 × $200 = **$7,200** |
| **3-year total** | **$1,904 – $4,404** | **$11,700 – $13,700** |
| **Difference** | — | **$7,300 – $11,800 more** |

Both sides include their build cost. The custom store costs roughly **two to four times as much over three years**.
| Own the code | No | **Yes** |
| Own the data | Yes (exportable) | **Yes** |
| Leave without starting over | No | **Yes** |

**Over three years the custom store costs meaningfully more.** That is the truth, and it means the pitch is **ownership and fit, not savings**:

> This costs more than a platform subscription and I want to be straight about that. What you get for it is a store built for how you actually work, that you own outright, on accounts in your name, with no platform that can change its terms or hold your store. If lower cost is the priority, a hosted platform will serve you better and I will tell you so.

That paragraph is the product. It filters out clients who will resent the price and attracts the ones who value what you are actually selling.

---

## 5. What to confirm after the demo is built

Everything above is a **starting position**. The demo tells you:

1. **Your real build hours** per tier. If Standard takes 70 hours, $6,500 is $93/hr — acceptable. If it takes 110, it is $59/hr and the price is wrong.
2. **Your real monthly care hours.** If monitoring and patching settle at 3 hours a month, Care at $200 is under your rate and should be $300.
3. **Whether the tiers are the right shape.** Maybe sellers want 100 products, not 50.

**Then change the prices.** The numbers here exist so you can quote something defensible today, not so you are stuck with them.

---

## 6. Sources

All figures retrieved September 2026 and linked in the research log for this task: Osdire, webcostly, hammanitech, galaxywing, Clutch, WebFX, GoDaddy (via ueni.com), venbit, tuesday.is, projectcostestimator, GoodFirms (via aiwebhub's 2026 survey comparison).

**Caveat:** these are published marketing guides from firms that sell these services. Their ranges are wide, mutually inconsistent, and not audited. They are useful for locating a defensible band and useless as a precise figure. The factor-of-five spread noted in Section 0 is the honest headline.
