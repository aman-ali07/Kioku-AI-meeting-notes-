import "next-auth";

// Augment only what next-auth v4 doesn't already type: our JWT `uid` claim
// (set in src/auth.ts jwt callback) reaching the session as user.id.
declare module "next-auth" {
  interface Session {
    user?: {
      id: string;
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
