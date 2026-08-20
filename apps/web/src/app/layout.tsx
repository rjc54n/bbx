import type { Metadata } from "next";
// Self-hosted via the geist package (bundled woff2) rather than next/font/google,
// so the production build never fetches Google-hosted fonts at build time -- the
// dependency that failed a sandboxed build (repository-health review). The CSS
// variables (--font-geist-sans / --font-geist-mono) are unchanged.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "BBX",
  description: "Private BBX catalogue research and cellar management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col overflow-hidden">{children}</body>
    </html>
  );
}
