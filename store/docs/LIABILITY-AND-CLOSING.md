# Liability & Closing Checklist - Custom Store V1

**Status:** briefing document for a licensed attorney
**Date:** 28 September 2026
**Prepared by:** Victoria Luna Consulting LLC, with AI assistance
**Companion to:** `MVP-SPEC.md`, `DATA-AND-API.md`, `PRICING-MODEL.md`

---

## ⚠️ What this document is, and is not

**This is not legal advice and contains no legal drafting.** It is a briefing: a list of the risks this business creates and the questions an attorney needs to answer. Every clause referenced here must be **drafted or approved by a licensed Colorado attorney**. Victoria Luna Consulting LLC is not a law firm and does not provide legal advice.

The purpose is to make the attorney's time efficient - arriving with the risk list already assembled rather than spending billable hours discovering it.

---

## 1. Why this service creates more liability than the rest of the business

Everything else on the website is administrative work with a defined end. A custom store is different in four ways:

1. **It takes money from other people.** If it fails during trading hours, the client loses sales and blames the consultant.
2. **It holds personal data.** Customer names, emails, addresses, and order histories sit in a database the consultant built.
3. **It depends on third parties the consultant does not control** - Cloudflare and Stripe can have outages, change APIs, or change terms.
4. **It requires ongoing maintenance that is a condition of the sale.** A required retainer is an ongoing obligation, not a one-time deliverable.

Only one of those four (payment handling) is mitigated by architecture - Stripe Checkout means no card data ever touches the consultant's systems, which reduces PCI scope to the lightest self-assessment (**SAQ A**) rather than removing it. The **client, as merchant of record, still completes that attestation**. The other three need contractual handling.

### The two different UPL questions - do not conflate them

There are two separate unauthorized-practice-of-law questions in this business, and they point in opposite directions:

1. **Drafting your own business's documents.** Preparing the service agreement for Victoria Luna Consulting LLC, for its own engagements, is generally permitted - people and businesses may handle their own legal affairs. **This document is about question 1.**
2. **Preparing documents for clients.** This is the UPL risk, and it is why the Legal Disclaimer carries a Scope of Services clause: the business prepares documents administratively, using templates the client selects and approves, and refers anything requiring legal judgment to a licensed attorney.

**Nothing in this briefing authorises the business to draft contracts for clients, to advise clients on their legal rights, or to represent them.** Those remain out of scope, unchanged, and the site's published terms already say so.

One caution on the first point: *"you may draft your own contract"* is a **general principle, not a Colorado-specific legal opinion.** The boundary is ultimately the state bar's to draw, not ours - which is the second reason this briefing goes to an attorney rather than standing in for one.

---

## 2. Scenarios to put in front of the attorney

| # | Scenario | What it exposes |
|---|---|---|
| 1 | Store goes down during a sale weekend | Lost revenue claim against the consultant |
| 2 | Payment processing fails mid-checkout | A customer is charged but no order is recorded |
| 3 | A customer is double-charged | The client's customer demands more than a refund |
| 4 | Customer database is breached | Personal data exposure; notification duties |
| 5 | Sales tax is calculated or remitted wrongly | Tax authority pursues **the client** - but the client looks for someone to blame |
| 6 | Stripe changes its API and the store needs rework | Is that included in the retainer or a change order? |
| 7 | Client does not pay the final invoice | What leverage exists - and what leverage is not available |
| 8 | Client wants to leave after six months | Handover obligations, credentials, and code |
| 9 | The consultant is unavailable for a week | Who maintains the store? |
| 10 | Client sues | Jurisdiction, venue, liability cap |
| 11 | Client's own customer sues over a purchase | Is the consultant in the chain at all? |
| 12 | Consultant reuses their own template for the next client | Whether the first client has any claim over the framework |

---

## 3. Questions the attorney needs to answer

1. **Liability cap.** What cap is enforceable and reasonable - a fixed sum, or fees paid in the preceding 6–12 months? Does a cap survive a negligence claim in Colorado?
2. **Uptime and availability.** How do we disclaim any uptime guarantee explicitly, given the store runs on Cloudflare and Stripe infrastructure we do not control?
3. **Consequential loss.** How do we exclude lost profits and lost sales clearly enough to be enforceable - and what language actually achieves that in Colorado?
4. **Third-party outages.** How is responsibility apportioned when Cloudflare or Stripe fails through no fault of ours?
5. **Tax.** Confirm that the client is the merchant of record and is solely responsible for tax determination, collection, and remittance. What wording makes that unambiguous?
6. **Data protection.** Who is the data controller and who is the processor? What are the notification duties if client customer data is exposed? Do state breach-notification statutes apply to us or only to the client?
7. **A mandatory maintenance retainer.** Is requiring a maintenance plan as a condition of the build enforceable, or does it create any problem we should avoid? If it is required, how should default-on-payment be handled?
8. **Intellectual property split.** How do we structure ownership so the client owns **their** store while we retain rights to **our reusable framework** - the thing that makes the second build profitable?
9. **Payment terms.** 50% upfront, 50% on delivery. What late-payment and collections language is appropriate and enforceable?
10. **Scope change.** How should the change-order process be expressed so that "one more small thing" is provably out of scope?
11. **Indemnity.** Should indemnity be mutual, or client-protective? What is standard here and what is overreaching?
12. **Dispute resolution.** Venue and jurisdiction in Colorado. Mediation first? Is arbitration advisable or a trap?
13. **Insurance.** E&O / professional liability and cyber liability - is either effectively required before selling this service? What limits are appropriate for a solo consultant?
14. **Entity and signing.** Confirm the agreement is signed by Victoria Luna Consulting LLC and that the wording does not expose the individual behind it personally.
15. **Existing document conflicts.** The UPL scope clause on the Legal Disclaimer says work involving legal judgment is referred out. Confirm nothing in this agreement contradicts the site's published terms.

---

## 4. Clauses the agreement should contain

For the attorney to draft or approve - this is a **requirements list**, not wording:

- **Scope of work** - the tier purchased, what it includes, with the exclusions referenced and attached
- **Explicit exclusions** - the Section 4 list from `MVP-SPEC.md`, attached as a schedule
- **Change-order process** - anything outside scope is quoted and approved in writing before work begins
- **Client responsibilities** - their credentials, their content, their domain, their Cloudflare and Stripe accounts, their legal and tax compliance
- **No uptime guarantee** - availability depends on third-party services
- **No warranty of fitness for a particular purpose**
- **Limitation of liability** with a defined cap
- **Exclusion of consequential and indirect loss**
- **Third-party services disclaimer** - Cloudflare, Stripe, and any email provider are not under our control and their terms bind the client
- **Tax responsibility** - client is merchant of record
- **Data handling** - what is collected, who controls it, retention, and breach notification
- **Code ownership split** - client work product versus our reusable framework, with a licence back to us
- **Maintenance retainer** - required, its inclusions, its hour block, and what happens on non-payment
- **Termination** - notice period, what is owed, handover obligations
- **Handover** - credentials, documentation, and code delivered on final payment
- **Payment terms** - deposit, final invoice, late fees
- **Indemnity**
- **Dispute resolution and venue** - Colorado

---

## 5. Closing checklist

### Before quoting
- [ ] Attorney has reviewed and approved the agreement
- [ ] The exclusions list is attached and current
- [ ] Insurance position confirmed (E&O / cyber) and in force if required
- [ ] Written confirmation that the client will own their Cloudflare and Stripe accounts, in their name
- [ ] The client understands they are the merchant of record for tax

### Before the build begins
- [ ] Agreement signed by **Victoria Luna Consulting LLC** and the client
- [ ] Deposit received (50%) - **no work before cleared funds**
- [ ] Client has created their own Cloudflare account and their own Stripe account
- [ ] Client has completed Stripe's own verification (their obligation, not ours)
- [ ] Scope, tier, and product ceiling agreed in writing
- [ ] Maintenance plan selected and its terms acknowledged
- [ ] Access method agreed - client invites us, we do not hold their passwords

### Before launch
- [ ] Full QA checklist passed (`MVP-SPEC.md` Section 8)
- [ ] The nine safety requirements verified, specifically: server-side pricing, webhook signatures, idempotent orders, and session-ID authorisation
- [ ] Admin access restricted to named people
- [ ] Backup and restore tested once, not assumed
- [ ] Documentation written: add a product, fulfil an order, issue a refund
- [ ] Client has been walked through the admin on a call

### At handover
- [ ] Final invoice paid - or handover explicitly staged against payment
- [ ] Credentials and documentation delivered
- [ ] Confirmation in writing that the client has accepted the store
- [ ] Maintenance start date confirmed
- [ ] Exclusions reconfirmed in writing - what the store does not do

### After launch
- [ ] Maintenance hours tracked from month one, so pricing can be corrected with evidence
- [ ] Real build hours recorded, per tier, for the next pricing revision
- [ ] Any incident reviewed and written up

---

## 6. Promises not to make

Every one of these creates liability that no contract can fully undo. Do not put them in a proposal, an email, or a listing.

- A specific uptime figure ("99.9%")
- "We will keep it running" without a maintenance agreement behind it
- "You will never lose data"
- "It will be totally secure"
- "Payments will always work"
- "It's cheaper than Shopify" (see `PRICING-MODEL.md` Section 4 - usually false)
- "Shopify-compatible" or any claim of feature parity with a platform
- Anything resembling legal, tax, or accounting advice

---

## 7. What to bring to the attorney

1. `MVP-SPEC.md` - what is being sold, and the exclusions
2. `PRICING-MODEL.md` - build tiers, required retainer, payment structure
3. This document - the risk list and questions
4. The existing Legal Disclaimer, Privacy Policy, and Terms of Service - to check for conflicts
5. Confirmation of the entity name and its registration

**Expect the attorney to change things.** That is the point of hiring one. Nothing here should be treated as settled until they have reviewed it.

---

## 8. Honest limits

Drafted with AI assistance. The risk list is drawn from ordinary commercial practice, not from Colorado statute or case law, and **no part of it has been reviewed by a lawyer.** It may be incomplete, and the questions may not be the right ones for this specific service. Its only value is saving the attorney time on discovery - not substituting for their judgement.
