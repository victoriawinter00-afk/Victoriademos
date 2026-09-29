/**
 * Admin authentication — Cloudflare Access JWT verification.
 *
 * THE POINT, and it governs this whole phase:
 *
 * Cloudflare Access sits in front of the deployed hostname and injects a signed
 * `Cf-Access-Jwt-Assertion` header. But this Worker ALSO answers on a
 * `workers.dev` hostname, which Access does not cover unless it is configured
 * for it separately. So a route that merely checks "is the header present?"
 * is reachable by anyone who knows that hostname and can type a header by hand.
 *
 * The header's PRESENCE is not evidence. Only its SIGNATURE is. So the token is
 * verified cryptographically against Cloudflare's published keys, and its
 * audience, issuer and validity window are checked too. Only then is the
 * administrator's email read, and only for the audit log.
 *
 * Configured entirely through env: CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD.
 *
 * A note on why this is testable locally: Cloudflare signs with an `iss` equal
 * to the same team domain that serves the JWKS, so ONE variable supplies both
 * the JWKS URL and the expected issuer. Point it at a local JWKS server and the
 * real verification path runs unchanged — no bypass, no test-only branch.
 */

const JWKS_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;
const ALLOWED_ALGORITHM = "RS256";

/* Module-level cache: a Worker isolate reuses it between requests. Never fetch
   the keys per request — that would make every admin call depend on a network
   round trip and would invite rate limiting. */
let jwksCache = { url: null, expiresAt: 0, keys: [] };

function decodeSegment(segment) {
  const normalised = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(decodeSegment(segment)));
}

function teamDomainOf(env) {
  const raw = typeof env.CF_ACCESS_TEAM_DOMAIN === "string" ? env.CF_ACCESS_TEAM_DOMAIN : "";
  return raw.replace(/\/+$/, "");
}

async function getJwks(env) {
  const teamDomain = teamDomainOf(env);
  if (!teamDomain) throw new Error("CF_ACCESS_TEAM_DOMAIN is not configured");

  const url = `${teamDomain}/cdn-cgi/access/certs`;
  const now = Date.now();
  if (jwksCache.url === url && jwksCache.expiresAt > now && jwksCache.keys.length > 0) {
    return jwksCache;
  }

  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`JWKS fetch failed with status ${response.status}`);
  }

  const body = await response.json();
  const keys = Array.isArray(body && body.keys) ? body.keys : [];
  if (keys.length === 0) throw new Error("JWKS contained no keys");

  jwksCache = { url, expiresAt: now + JWKS_TTL_MS, keys };
  return jwksCache;
}

async function verifySignature(jwk, signingInput, signature) {
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: ALLOWED_ALGORITHM, ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(signingInput),
  );
}

function audienceMatches(claim, expected) {
  if (typeof claim === "string") return claim === expected;
  if (Array.isArray(claim)) return claim.includes(expected);
  return false;
}

/**
 * Returns the verified admin identity, or null.
 *
 * Every failure path returns null. Nothing throws outward, and a failure to
 * reach the JWKS is a failure to authenticate — never a pass.
 */
export async function requireAdmin(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;

  const segments = token.split(".");
  if (segments.length !== 3) return null;
  const [headerSegment, payloadSegment, signatureSegment] = segments;

  let header;
  let payload;
  try {
    header = decodeJsonSegment(headerSegment);
    payload = decodeJsonSegment(payloadSegment);
  } catch {
    return null;
  }

  // Reject any algorithm that is not exactly RS256 — this is what stops
  // "alg: none" and algorithm-confusion tricks before any key work happens.
  if (!header || header.alg !== ALLOWED_ALGORITHM) return null;
  if (typeof header.kid !== "string" || header.kid === "") return null;

  let jwks;
  try {
    jwks = await getJwks(env);
  } catch (error) {
    console.error(
      `admin: cannot verify access tokens — ${error && error.message ? error.message : "unknown"}`,
    );
    return null;
  }

  const jwk = jwks.keys.find(
    (candidate) => candidate && candidate.kid === header.kid && candidate.kty === "RSA",
  );
  if (!jwk) return null;

  let signature;
  try {
    signature = decodeSegment(signatureSegment);
  } catch {
    return null;
  }

  let signatureValid = false;
  try {
    signatureValid = await verifySignature(jwk, `${headerSegment}.${payloadSegment}`, signature);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number") return null;
  if (payload.exp < now - CLOCK_SKEW_SECONDS) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + CLOCK_SKEW_SECONDS) return null;

  const expectedAudience = env.CF_ACCESS_AUD;
  if (typeof expectedAudience !== "string" || expectedAudience === "") return null;
  if (!audienceMatches(payload.aud, expectedAudience)) return null;

  const teamDomain = teamDomainOf(env);
  if (typeof payload.iss !== "string") return null;
  if (payload.iss.replace(/\/+$/, "") !== teamDomain) return null;

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!email) return null;

  return {
    email,
    subject: typeof payload.sub === "string" ? payload.sub : null,
  };
}
