/**
 * Server-side environment access.
 *
 * Lazy on purpose: validators run on first real use, so `next build` never
 * requires a live database or a secret. Config comes from the environment
 * only — nothing here supplies defaults that could leak into prod.
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
