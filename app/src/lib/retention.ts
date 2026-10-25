/** Human label for workspace retention; NULL means no automatic deletion. */
export function formatRetention(days: number | null): string {
  if (days === null) return "Forever";
  return `${days} day${days === 1 ? "" : "s"}`;
}
