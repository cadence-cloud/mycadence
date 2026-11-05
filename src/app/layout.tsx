import type { Metadata, Viewport } from "next";
import "./globals.css";
import { isDemo } from "@/lib/env";
import Link from "next/link";

export const metadata: Metadata = {
  title: "My Cadence",
  description: "Your plan, progress and messages from Cadence Physical Therapy.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemo();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        {demo && (
          <div className="bg-lime-300 px-4 py-1.5 text-center text-xs font-semibold text-black">
            Demo environment · fictional patients · notifications are simulated ·{" "}
            <Link href="/demo" className="underline underline-offset-2">
              Switch role
            </Link>
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
