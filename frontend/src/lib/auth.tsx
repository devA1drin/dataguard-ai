"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import type { LoginResult, Role, SessionUser } from "./types";

/**
 * Auth state. Live mode: nothing sensitive is stored in the browser - the session is an
 * httpOnly cookie, and on load we simply ask the API "who am I?" (/auth/me).
 */
interface AuthCtx {
  user: SessionUser | null;
  ready: boolean;
  /** Returns the user, or { mfa_token } when a second step is needed. */
  login(email: string, password: string): Promise<SessionUser | { mfa_token: string }>;
  verifyMfa(mfaToken: string, code: string): Promise<SessionUser>;
  signup(body: { full_name: string; email: string; password: string }): Promise<SessionUser>;
  demoLogin(role: Role): Promise<SessionUser>;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try { setUser(await api.me()); } catch { setUser(null); }
  }, []);
  useEffect(() => { void refresh().finally(() => setReady(true)); }, [refresh]);

  const done = useCallback((r: LoginResult): SessionUser => {
    if ("mfa_required" in r) throw new Error("MFA required");
    setUser(r.user);
    return r.user;
  }, []);

  const value: AuthCtx = {
    user, ready, refresh,
    login: async (email, password) => {
      const r = await api.login(email, password);
      if ("mfa_required" in r) return { mfa_token: r.mfa_token };
      return done(r);
    },
    verifyMfa: async (t, code) => done(await api.verifyMfa!(t, code)),
    signup: async (body) => done(await api.signup!(body)),
    demoLogin: async (role) => done(await api.demoLogin!(role)),
    logout: async () => { try { await api.logout(); } finally { setUser(null); window.location.href = "/login"; } },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

export const homeFor = (role: Role) => (role === "customer" ? "/portal/consents" : "/admin");
