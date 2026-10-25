import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { DemoBanner } from "@/components/DemoBanner";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DataGuard AI — Data Protection & Security Operations",
  description: "Student capstone: data protection and security operations - consent, data rights, sign-in threat monitoring, MFA, ML detection and incident response (synthetic data).",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the per-request nonce makes every page dynamically rendered, which the nonce-based CSP
  // (src/proxy.ts) requires; Next.js then stamps the nonce on its own scripts automatically.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" data-csp={nonce ? "nonce" : undefined} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <DemoBanner />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
