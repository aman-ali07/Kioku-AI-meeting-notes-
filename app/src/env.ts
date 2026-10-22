/**
 * Server-side environment access.
 *
 * Config comes from the environment only — nothing here supplies defaults
 * that could leak into prod. Note (checked against the adapter's behavior):
 * modules importing the db client evaluate DATABASE_URL at module scope, so
 * builds/CI need DATABASE_URL present (a placeholder suffices; actual
 * connection happens on first query). Fail loud, fail early.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name} (see app/.env.example)`,
    );
  }
  return value;
}

/** Google sign-in is offered only when both credentials are present (plan §5). */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}
