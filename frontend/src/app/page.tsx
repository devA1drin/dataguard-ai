"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/ui";
import { homeFor, useAuth } from "@/lib/auth";

export default function Home() {
  const { user, ready } = useAuth();
  const router = useRouter();
  useEffect(() => { if (ready) router.replace(user ? homeFor(user.role) : "/login"); }, [ready, user, router]);
  return <div className="p-10"><Loading /></div>;
}
