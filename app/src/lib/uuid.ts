/**
 * Canonical UUID (8-4-4-4-12). Postgres accepts looser input forms (braces,
 * no hyphens); we deliberately don't — route/tenant ids come from our own
 * URLs, so anything else is malformed and must fail closed.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
