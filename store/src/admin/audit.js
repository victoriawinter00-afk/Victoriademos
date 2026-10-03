/**
 * Admin audit trail.
 *
 * The rule is "no write without an audit row", so the audit insert is not a
 * follow-up call that could be forgotten or could fail after the write landed.
 * It is returned as a statement that the caller puts in the SAME D1 batch as the
 * write itself: D1 batches are transactional, so the pair commits together or
 * not at all. A forgotten audit row is therefore not a code-review problem, it
 * is impossible.
 */

export const AUDIT_ACTIONS = {
  productCreate: "product.create",
  productUpdate: "product.update",
  productSoftDelete: "product.soft_delete",
  productImage: "product.image",
  orderFulfil: "order.fulfil",
};

/** Statement factory - pass into env.DB.batch([ write, auditStatement(...) ]). */
export function auditStatement(env, { actor, action, target }) {
  return env.DB.prepare(
    `INSERT INTO admin_audit (id, actor_email, action, target, created_at)
     VALUES (?1, ?2, ?3, ?4, datetime('now'))`,
  ).bind(crypto.randomUUID(), actor, action, target);
}

export function changesOf(result) {
  return result?.meta?.changes ?? result?.changes ?? 0;
}
