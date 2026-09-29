/**
 * Public image serving.
 *
 * The bucket stays private: nothing is exposed except through this Worker, which
 * is what makes the response headers enforceable. The object key is validated
 * against the exact shape the upload endpoint generates BEFORE it is passed to
 * R2, so a traversal attempt never reaches the bucket at all.
 *
 * The response headers exist for one reason: a stored file must never be
 * reinterpreted by a browser as markup or script.
 *   - content-type from the extension of our own validated key (never from
 *     client input, and never guessed)
 *   - content-disposition: inline
 *   - x-content-type-options: nosniff — the header that stops a browser deciding
 *     a file is HTML because it looks like HTML
 */

const KEY_PATTERN = /^products\/[a-z0-9][a-z0-9-]{0,79}-[0-9a-f]{8}\.(jpg|png|webp)$/;
const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function notFound() {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: JSON_HEADERS,
  });
}

function serverError() {
  return new Response(JSON.stringify({ error: "server_error" }), {
    status: 500,
    headers: JSON_HEADERS,
  });
}

export async function serveImage(request, env, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  let key;
  try {
    key = decodeURIComponent(pathname.slice("/images/".length));
  } catch {
    return notFound();
  }

  // Validated before R2 is touched: an unknown or malformed key is a 404 with no
  // bucket access, no listing, and no provider error surfaced.
  if (!KEY_PATTERN.test(key)) return notFound();

  let object;
  try {
    object = await env.IMAGES.get(key);
  } catch (error) {
    console.error(`images: read failed — ${error && error.message ? error.message : "unknown"}`);
    return serverError();
  }
  if (!object) return notFound();

  const extension = key.slice(key.lastIndexOf(".") + 1);
  const headers = {
    "content-type": CONTENT_TYPES[extension],
    "content-disposition": "inline",
    "x-content-type-options": "nosniff",
    // Keys are unique per upload, so a long cache can never serve a stale image.
    "cache-control": "public, max-age=31536000, immutable",
  };
  if (object.httpEtag) headers.etag = object.httpEtag;

  if (object.httpEtag && request.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(object.body, { headers });
}
