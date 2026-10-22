import type { NextAuthOptions } from "next-auth";
import Email from "next-auth/providers/email";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db/client";
import { ensurePersonalWorkspace } from "@/provision";

export const authOptions: NextAuthOptions = {
  adapter: DrizzleAdapter(db),
  // JWT sessions: the adapter still stores verification tokens for the email
  // provider, but we skip DB-backed session lookups. user.id travels in the
  // token so every session resolves a tenant without extra queries.
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Email({
      // Dev "transport": magic links go to the server log instead of SMTP.
      // Real email delivery (Brevo/Resend) is a later plan milestone — until
      // then this is the only send path, on purpose, so no half-configured
      // transport ever silently drops a link.
      sendVerificationRequest: async ({ identifier, url }) => {
        console.log(`\n🔑 Magic link for ${identifier}:\n  ${url}\n`);
      },
    }),
    // Google is enabled only in deployments that provide credentials; the
    // button simply doesn't exist otherwise (plan §5: no fake options).
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    jwt: async ({ user, token }) => {
      if (user?.id) {
        token.uid = user.id;
        // Idempotent first-workspace provisioning; a db failure propagates
        // (fail-closed) rather than minting a tenant-less session.
        await ensurePersonalWorkspace(user.id);
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user && token.uid) {
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
};
