# Victoriademos

Demonstration projects. Each one is a real, working build rather than a mockup,
and each lives in its own directory with its own README, dependencies, and
Cloudflare bindings.

## Demos

- **[`store/`](store/README.md)** - a small, client-owned online store. One
  Cloudflare Worker serves both the static storefront and a product API over D1,
  with physical, digital, and service products. No payment code and no
  deployment in this phase.

## Layout

One directory per demo. Run instructions, prerequisites, and limits live in the
demo's own `README.md`. The root `.gitignore` covers the shared build and
local-state paths (`node_modules/`, `.wrangler/`, `.dev.vars`, `.env*`) so new
demos inherit them without repeating the rules.
