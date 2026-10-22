"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export function SignInForm({
  googleEnabled,
  callbackUrl,
}: {
  googleEnabled: boolean;
  callbackUrl: string;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      // redirect:false — stay here and show the "check your inbox" state.
      // The dev server prints the magic link to its console (console transport).
      await signIn("email", { email, callbackUrl, redirect: false });
      setSent(true);
    } catch {
      setError("Could not start sign-in. Check the server log for details.");
    }
  }

  if (sent) {
    return (
      <div className="rounded-md border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-200">
        <p className="font-medium">Magic link sent to {email}</p>
        <p className="mt-1 text-emerald-300/80">
          Open the link from your email. In dev, the link is printed to the
          app server console.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-sm text-neutral-400">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400"
        >
          Continue with email
        </button>
      </form>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs text-neutral-600">
            <span className="h-px flex-1 bg-neutral-800" />or
            <span className="h-px flex-1 bg-neutral-800" />
          </div>
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl })}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500"
          >
            Continue with Google
          </button>
        </>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
