/**
 * `/api/admin/*` router.
 *
 * The guard runs first and everything behind it fails closed. Every
 * unauthenticated outcome is **404**, never 403: a 403 would confirm that the
 * route exists to someone who is not allowed to know that. An authenticated
 * caller hitting an unknown admin path also gets 404, so the response shape does
 * not distinguish "not allowed" from "not there".
 */

import { requireAdmin } from "./auth.js";
import { createProduct, listProducts, softDeleteProduct, updateProduct } from "./products.js";
import { uploadProductImage } from "./images.js";
import { fulfilOrder, getOrder, listOrders } from "./orders.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function notFound() {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: JSON_HEADERS,
  });
}

function methodNotAllowed() {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: JSON_HEADERS,
  });
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export async function handleAdmin(request, env, pathname) {
  const admin = await requireAdmin(request, env);
  if (!admin) return notFound();

  const method = request.method;

  if (pathname === "/api/admin/products" || pathname === "/api/admin/products/") {
    if (method === "GET") return listProducts(env);
    if (method === "POST") return createProduct(request, env, admin.email);
    return methodNotAllowed();
  }

  const imageMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)\/image\/?$/);
  if (imageMatch) {
    const slug = decodeSegment(imageMatch[1]);
    if (!slug) return notFound();
    if (method === "POST") return uploadProductImage(request, env, admin.email, slug);
    return methodNotAllowed();
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)\/?$/);
  if (productMatch) {
    const slug = decodeSegment(productMatch[1]);
    if (!slug) return notFound();
    if (method === "PATCH") return updateProduct(request, env, admin.email, slug);
    if (method === "DELETE") return softDeleteProduct(env, admin.email, slug);
    return methodNotAllowed();
  }

  if (pathname === "/api/admin/orders" || pathname === "/api/admin/orders/") {
    if (method === "GET") return listOrders(request, env);
    return methodNotAllowed();
  }

  const orderMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/?$/);
  if (orderMatch) {
    const id = decodeSegment(orderMatch[1]);
    if (!id) return notFound();
    if (method === "GET") return getOrder(env, id);
    if (method === "PATCH") return fulfilOrder(request, env, admin.email, id);
    return methodNotAllowed();
  }

  return notFound();
}
