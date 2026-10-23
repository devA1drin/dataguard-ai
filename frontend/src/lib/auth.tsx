"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, tokenStore } from "./api";
import type { Role, SessionUser } from "./types";

interface AuthCtx {
  user: SessionUser | null;
  ready: boolean;
  login(email: string, password: string): Promise<SessionUser>;
  demoLogin(role: Role): Promise<SessionUser>;
  logout(): void;
}
const Ctx = createContext<AuthCtx | null>(null);
const USER_KEY = "dataguard-user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(USER_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (raw && tokenStore.get()) setUser(JSON.parse(raw));
    setReady(true);
  }, []);

  const persist = useCallback((token: string, u: SessionUser) => {
    tokenStore.set(token);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
    return u;
  }, []);

  const value: AuthCtx = {
    user, ready,
    login: async (email, password) => { const r = await api.login(email, password); return persist(r.token, r.user); },
    demoLogin: async (role) => { const r = await api.demoLogin!(role); return persist(r.token, r.user); },
    logout: () => { tokenStore.clear(); localStorage.removeItem(USER_KEY); setUser(null); window.location.href = "/login"; },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

export const homeFor = (role: Role) => (role === "customer" ? "/portal/consents" : "/admin");
