import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { SignInForm } from "@/components/signin-form";
import { isGoogleAuthConfigured } from "@/env";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  const params = await searchParams;
  const callbackUrl =
    typeof params.callbackUrl === "string" ? params.callbackUrl : "/dashboard";

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-8 px-6 py-24">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Kioku</h1>
        <p className="text-sm text-neutral-400">
          We&apos;ll email you a magic link — no password needed.
        </p>
      </div>
      <SignInForm
        googleEnabled={isGoogleAuthConfigured()}
        callbackUrl={callbackUrl}
      />
    </main>
  );
}
