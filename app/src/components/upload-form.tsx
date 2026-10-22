"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Minimal upload flow for the Days 4–6 slice: pick a file, POST it to
 * /api/upload, refresh so the server component shows the new row. No drag
 * & drop or progress bars until the UI milestone decides on them.
 */
export function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError("Choose an audio file first");
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("title", file.name.replace(/\.[^.]+$/, ""));
      const response = await fetch("/api/upload", { method: "POST", body });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(detail?.error ?? `Upload failed (${response.status})`);
        return;
      }
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch {
      setError("Upload failed — check your connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="mt-8">
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,video/mp4,video/webm,.mp3,.m4a,.wav,.webm,.mp4,.ogg"
        disabled={busy}
        className="text-sm text-neutral-200 file:mr-3 file:rounded file:border-0 file:bg-neutral-700 file:px-3 file:py-1 file:text-neutral-100"
      />
      <button
        type="submit"
        disabled={busy}
        className="ml-3 rounded bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Upload meeting audio"}
      </button>
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
    </form>
  );
}
