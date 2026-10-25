"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/** Short link /scanner -> the Website Scanner page for the signed-in user's area. */
export default function ScannerRedirect() {
  const { user, ready } = useAuth();
  const router = useRouter();
  useEffect(() => { if (ready) router.replace(!user ? "/login" : user.role === "customer" ? "/portal/scanner" : "/admin/scanner"); }, [ready, user, router]);
  return <div className="p-10"><Loading /></div>;
}
