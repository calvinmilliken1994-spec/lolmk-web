/**
 * Who wrote an audit row, shared by rb_audit_log, mayhem_audit_log and
 * sr_audit_log (each has a nullable `actor_kind` column; rows written before
 * it existed are null).
 *
 * - "admin": a tools admin acting from a desk (getCurrentAdmin()).
 * - "member": a signed-in member acting for themselves, e.g. an SR captain
 *   creating an application or a rostered player confirming an invite.
 */
export type AuditActorKind = "admin" | "member";

export function isAuditActorKind(v: unknown): v is AuditActorKind {
  return v === "admin" || v === "member";
}

/**
 * Activity-log label: "Calvin (admin)", "Mina (captain)". `role` replaces the
 * generic "member" when the caller knows better (captain). Old rows with no
 * kind show the bare name.
 */
export function formatAuditActor(name: string, kind: AuditActorKind | null | undefined, role?: string): string {
  if (!kind) return name;
  return `${name} (${kind === "admin" ? "admin" : (role ?? "member")})`;
}
