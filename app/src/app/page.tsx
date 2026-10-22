import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Kioku</h1>
      <p className="text-lg text-neutral-300">
        Your meetings, remembered. Open-source, self-hostable AI meeting notes —
        record, transcribe, summarize, search.
      </p>
      <div className="flex gap-4">
        <Link
          href="/dashboard"
          className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400"
        >
          Open dashboard
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-neutral-700 px-4 py-2 font-medium text-neutral-200 hover:border-neutral-500"
        >
          Sign in
        </Link>
      </div>
      <p className="text-sm text-neutral-500">
        Scaffold build — the transcription pipeline lands in the Days 4–6
        milestone of the plan.
      </p>
    </main>
  );
}
