/**
 * Product image upload.
 *
 * An endpoint that accepts arbitrary bytes is an endpoint that can serve hostile
 * content from the store's own origin, so the checks here are about what the file
 * IS, not what the caller says it is:
 *
 *   - the declared content-type must be on the allowlist, and
 *   - the BYTES must be a real JPEG, PNG or WebP, and
 *   - the two must agree.
 *
 * A declared type is a claim by the client. A filename extension is a claim by
 * the client. Neither is evidence. The leading bytes are the only evidence, and
 * the stored type and extension are derived from them.
 *
 * SVG is deliberately not offered: it is a document format that can carry script
 * and be styled, and "it is an image" is exactly the reasoning that ends with an
 * SVG being served from a shop's own domain.
 */

import { AUDIT_ACTIONS, auditStatement } from "./audit.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/* 5 MiB: comfortably more than a product photograph, small enough that an
   accidental or hostile upload cannot fill the bucket. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_DECLARED = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function ascii(bytes, offset, length) {
  let out = "";
  for (let index = offset; index < offset + length; index += 1) {
    out += String.fromCharCode(bytes[index]);
  }
  return out;
}

/** The only trustworthy description of a file's type. */
export function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** POST /api/admin/products/:slug/image — raw image body. */
export async function uploadProductImage(request, env, actor, slug) {
  const product = await env.DB.prepare(
    `SELECT slug, image_key FROM products WHERE slug = ?1`,
  )
    .bind(slug)
    .first();
  if (!product) return json({ error: "not_found", message: "No product with that slug." }, 404);

  const declared = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_DECLARED.has(declared)) {
    return json(
      { error: "unsupported_type", message: "Only JPEG, PNG and WebP images are accepted." },
      415,
    );
  }

  /* Refuse an oversized upload before reading it, where the client tells us the
     size. The header is client-supplied, so the length is checked again below on
     what was actually received. */
  const declaredLength = Number.parseInt(request.headers.get("content-length") || "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    return json(
      { error: "too_large", message: `Images must be ${MAX_IMAGE_BYTES} bytes or fewer.` },
      413,
    );
  }

  let bytes;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return json({ error: "invalid_request", message: "The image could not be read." }, 400);
  }

  if (bytes.byteLength === 0) {
    return json({ error: "invalid_request", message: "The request body was empty." }, 400);
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return json(
      { error: "too_large", message: `Images must be ${MAX_IMAGE_BYTES} bytes or fewer.` },
      413,
    );
  }

  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    return json(
      { error: "unsupported_type", message: "Those bytes are not a JPEG, PNG or WebP image." },
      415,
    );
  }
  if (sniffed !== declared) {
    return json(
      {
        error: "type_mismatch",
        message: "The declared content-type does not match what the file actually is.",
      },
      415,
    );
  }

  /* Generated here, never from the client's filename — so a filename containing
     "../" has nothing to attach to, and no caller-supplied text reaches the key. */
  const imageKey = `products/${slug}-${crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, 8)}.${EXTENSIONS[sniffed]}`;

  try {
    await env.IMAGES.put(imageKey, bytes, { httpMetadata: { contentType: sniffed } });
  } catch (error) {
    console.error(
      `admin: image store failed — ${error && error.message ? error.message : "unknown"}`,
    );
    return json({ error: "server_error", message: "The image could not be stored." }, 500);
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET image_key = ?1, updated_at = datetime('now') WHERE slug = ?2`,
      ).bind(imageKey, slug),
      auditStatement(env, {
        actor,
        action: AUDIT_ACTIONS.productImage,
        target: `${slug}:${imageKey}`,
      }),
    ]);
  } catch (error) {
    // The row is what the storefront reads, so an object with no row would be
    // invisible garbage. Remove it rather than leave it behind.
    await env.IMAGES.delete(imageKey).catch(() => {});
    console.error(
      `admin: image row update failed — ${error && error.message ? error.message : "unknown"}`,
    );
    return json(
      { error: "server_error", message: "The image could not be attached to the product." },
      500,
    );
  }

  /* Best effort: drop the object this upload replaced, so replacing an image
     does not quietly accumulate orphans in the bucket. Failure is logged and not
     fatal — the new image is already recorded. */
  if (product.image_key && product.image_key !== imageKey) {
    try {
      await env.IMAGES.delete(product.image_key);
    } catch (error) {
      console.error(
        `admin: could not remove the replaced image — ${
          error && error.message ? error.message : "unknown"
        }`,
      );
    }
  }

  return json(
    { slug, image_key: imageKey, content_type: sniffed, bytes: bytes.byteLength },
    201,
  );
}
