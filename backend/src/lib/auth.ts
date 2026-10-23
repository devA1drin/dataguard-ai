import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";

export type Role = "customer" | "dpo" | "security" | "admin" | "executive";
export const ROLES: Role[] = ["customer", "dpo", "security", "admin", "executive"];

export interface AuthUser { id: number; role: Role; customerId: number | null; name: string }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

export function signToken(u: AuthUser): string {
  return jwt.sign(u, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

/** Verifies the Bearer JWT. Also accepts ?token= for EventSource (SSE), which cannot set headers. */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) return res.status(401).json({ error: "authentication required" });
  try {
    const p = jwt.verify(token, config.jwtSecret) as AuthUser;
    req.user = { id: p.id, role: p.role, customerId: p.customerId, name: p.name };
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

/** Role-based access control guard. */
export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "forbidden for your role" });
  next();
};

/** Staff groups used across routes */
export const STAFF: Role[] = ["dpo", "security", "admin", "executive"];
export const REVIEWERS: Role[] = ["dpo", "security", "admin"];
