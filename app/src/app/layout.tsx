import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kioku — Your meetings, remembered.",
  description:
    "Open-source, self-hostable AI meeting notes: record, transcribe, summarize, search.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
