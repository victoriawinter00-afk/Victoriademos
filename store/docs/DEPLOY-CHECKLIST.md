# Deploy Checklist - Custom Store V1

**Status:** pre-deployment. Nothing here has been done yet.
**Companion to:** `MVP-SPEC.md`, `DATA-AND-API.md`
**Why this exists:** several values in the working tree are **local test values or placeholders**. Deploying with any of them in place produces a store that looks deployed and is silently broken - or in one case, silently unreachable.

---

## BLOCKERS - a local value that must not ship

| Setting | Current local value | Risk if shipped |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | `http://127.0.0.1:8788` | **Fails closed** - every admin request gets 404, so admin becomes permanently unreachable and looks like a routing bug |
| `CF_ACCESS_AUD` | `local-admin-aud` | Same: the audience check never matches, so every admin request is rejected |
| `database_id` in `wrangler.jsonc` | `f3b1c2d4-5e6a-4b7c-8d9e-0a1b2c3d4e5f` | **A placeholder.** Deploy would bind to a database that does not exist |
| `bucket_name` | `demo-store-images` | Probably fine as a name, but the bucket must be **created** |

**The first two are the dangerous ones** because they fail *closed*: the store works, the admin silently never does, and nothing in the logs looks like an error until someone investigates. A localhost JWKS URL cannot be fetched from a deployed Worker.

**These live in `store/.dev.vars` (local) and become Worker secrets/vars at deploy.** `.dev.vars` is gitignored and has never been committed - verified.

---

## Pre-deploy - Cloudflare resources

- [x] **Create the D1 database** - done 2026-09-30. `demo-store-db`, id `0aaab4bb-2f7b-42ae-ab90-73581cca1567`, region WNAM
- [x] **Copy the real `database_id`** into `wrangler.jsonc` - done
- [x] **Apply the schema remotely** - done, 7 tables
- [x] **Seed the catalog remotely** - done, 50 products (25 physical / 15 digital / 10 service), 1 deliberately out of stock
- [ ] **Enable R2 on the account first** - this is a prerequisite, not the same step as creating the bucket. Tested 2026-09-30: `wrangler r2 bucket list` returns **`Please enable R2 through the Cloudflare Dashboard. [code: 10042]`**, and Cloudflare's own error reference defines 10042 as *"Account not entitled to this feature. Ensure your account has an R2 subscription."* The get-started docs confirm: *"Complete the checkout flow to add an R2 subscription to your account."*
  - **Path:** account level → `Storage & databases` → `R2 Object Storage` → `Overview` → **Add R2 subscription to my account**
  - **R2 is ACCOUNT-level, not zone-level.** Do not enter the `victoriawinter00.com` zone - that is the opposite of the Redirect Rule, which was zone-scoped. Buckets belong to the account, not to a domain
  - **A payment method is required even for the free tier** (10 GB storage, 1M Class A / 10M Class B per month). Usage above the allocation is billable, not capped
  - **Provisioning can lag.** Other users report 10042 persisting briefly after checkout - wait a few minutes before concluding something is wrong
- [ ] **Create the R2 bucket** `demo-store-images` - **blocking the deploy.** The name must match `bucket_name` in `wrangler.jsonc` exactly. Confirmed empirically, not assumed: `wrangler deploy` fails with `R2 bucket 'demo-store-images' not found [code: 10085]`. A `--dry-run` **passes** and does not catch this, so the dry-run is not a valid preflight for resource existence
  - **Do NOT enable public access.** The bucket stays private and images are served through the Worker; a public bucket would bypass the content-type and `nosniff` controls that prevent a stored file being interpreted as HTML
- [x] **Confirm the Worker name** - `demo-store` does not exist yet; no collision

> **Local development note (E-27).** The `database_id` keys the **local** SQLite file as well as addressing the remote database, so replacing the placeholder **reset the local database** with no warning. It was restored with two commands, both fully regenerable from the repository:
> ```
> npx wrangler d1 execute demo-store-db --local --file=./schema.sql
> npm run db:seed
> ```

## Pre-deploy - Cloudflare Access

- [ ] **Create an Access application** covering **only the admin path** - not the whole site. The storefront must stay public
- [ ] **Copy the application's AUD tag** → `CF_ACCESS_AUD`
- [ ] **Set `CF_ACCESS_TEAM_DOMAIN`** to the real team domain
- [ ] **Decide the Access policy** - which identity provider, and which accounts may reach admin
- [ ] **Confirm whether the `workers.dev` hostname is covered.** If it is not, the Worker's own JWT verification is the only thing standing between a stranger and the admin API. That verification is built and tested - but know which layer is doing the work

## Pre-deploy - Stripe

- [ ] **Register a webhook endpoint** in the Stripe dashboard pointing at `/api/stripe/webhook` on the real hostname
- [ ] **Subscribe it to the events the handler implements:** `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`
- [ ] **Copy the endpoint's signing secret** (`whsec_…`) - this is the **real** one, not the locally-generated test value
- [ ] **Set `STRIPE_SECRET_KEY` as a Worker secret** - `wrangler secret put STRIPE_SECRET_KEY`
- [ ] **Set `STRIPE_WEBHOOK_SECRET` as a Worker secret**
- [ ] **Decide test mode versus live.** For a demo store: **stay in test mode** - no live activation needed

## Pre-deploy - repo hygiene

- [ ] `git status` clean
- [ ] No secret in any tracked file - **re-scan history, not just the working tree**
- [ ] `.dev.vars` still ignored and untracked
- [x] The placeholder `database_id` is genuinely replaced - done, real id in `wrangler.jsonc`

---

## DEPLOYED - 2026-09-30

**Version ID `27d4c132-216a-48d6-b511-370822452446`** · route `store.victoriawinter00.com` (custom domain) · D1 `demo-store-images` / `0aaab4bb-2f7b-42ae-ab90-73581cca1567`

**Verified after deploy (mechanism: live HTTPS from outside Cloudflare):**

| Check | Result |
|---|---|
| DNS | resolves - Cloudflare anycast (`104.21.12.195`, `172.67.195.161`) |
| `/api/products` | **200**, **50 products** - served from the **remote** D1, not local |
| `/` storefront | **200**, title `Demo Store - Products`, filters present, demo notice present |
| `/product/demo-physical-01` | **200** |
| `/cart` demo notice | present, wording matches the approved session copy |
| `/images/unknown-key.png` | **404** - key-shape validation rejecting it |
| `/api/admin/products` - no token | **404** (fail-closed, as designed) |
| `/api/admin/products` - **forged header** | **404** ← the guard rejecting a hand-typed header |
| `/api/checkout` | **500**, `error code: 1101` - **expected**. No `STRIPE_SECRET_KEY` is set remotely yet; fixed at Stage 5 |

**`custom_domain: true` worked** with this session's scopes. The one genuine unknown from the deploy-prep task is now answered - `workers_routes (write)` was sufficient, and no manual DNS step was needed.

**Correction - `workers.dev` is NOT a bypass here.** Earlier guidance said a custom domain leaves the `workers.dev` hostname live, so Access alone could be bypassed and the JWT guard was the real control. **Measured, that is wrong for this deployment:** `demo-store.victoria00business00.workers.dev` returns Cloudflare's **`error code: 1042`** page - the Worker is **not provisioned there at all**. The defence-in-depth reasoning was sound as a principle, and the guard is still what rejects a forged header, but **there is no `workers.dev` path to reach this Worker.** Do not repeat the earlier claim as fact.

**Still expected to fail, and correctly so:** admin is unreachable until the real Access values replace the placeholders - that is the fail-closed design, not a fault.

---

## The verification pass - what deploy is FOR

Two things cannot be verified locally. **This is the whole point of deploying.**

### 1. Cloudflare Access actually blocks (deploy-only)

- [ ] A request to the admin path **with no token** is refused at the edge
- [ ] A request **with a forged `Cf-Access-Jwt-Assertion` header** is refused - this tests the Worker's own verification, which is the layer that matters if `workers.dev` is uncovered
- [ ] A request **from a signed-in permitted account** reaches the admin API
- [ ] The storefront remains **publicly reachable** - Access must not have been applied too broadly

### 2. Webhook delivery with the real signing secret (E-19)

**The handler is verified with locally-signed payloads. Delivery never has been.** The real signing secret is the piece that breaks silently - a handler verified against self-signed input proves the logic and never the credential.

- [ ] Complete a real test-mode payment end to end
- [ ] **An order appears** in the deployed D1 - this is the assertion that matters, not the success page
- [ ] `processed_events` gains **exactly one** row for that event
- [ ] `stock` decrements and `reserved` returns to zero
- [ ] The **customer's email** is captured on the order
- [ ] `needs_attention` is **0** - if it is 1, the order could not be fulfilled as recorded

### 3. Storefront still whole

- [ ] Every page loads; catalog filters work; card add-to-cart works
- [ ] Cart persists across navigation and clears after a confirmed order
- [ ] The success page **shows the line items**
- [ ] Accessibility modes persist and apply before first paint
- [ ] **Zero third-party requests** - the property the whole design depends on

---

## Known gaps at deploy time

| Gap | Status |
|---|---|
| **Merchant notification email** | **Not sent.** `notifyMerchant()` only logs. Cloudflare Email Sending requires Workers Paid ($5/mo). The customer's address *is* captured on the order, so no data is lost |
| **Customer receipt email** | **Not sent**, and the success page says so |
| **Carrier / zone shipping** | Not offered by decision. Flat and weight-band only |
| **Image upload** | Built separately; until then product cards render without images |

## Rollback

- **Pages/Worker:** `wrangler rollback` restores the previous Worker version
- **D1 schema:** additive so far - no destructive migrations beyond a column placeholder. Verify before any change that drops
- **Repo:** every step is a commit; revert rather than force-push

**Nothing in this checklist has been executed.** It is written before the deploy so the local-value blockers are caught by reading, not by a broken storefront.