import "next-auth";

// Augment what next-auth v4 doesn't type. `id` stays OPTIONAL on purpose: at
// runtime a stale/malformed JWT can yield a session whose user has no id —
// consumers must guard (see dashboard/page.tsx) instead of trusting "".
declare module "next-auth" {
  interface Session {
    user?: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
  }
}
