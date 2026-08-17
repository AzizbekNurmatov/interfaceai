import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

interface Session {
  user: string;
}

const sessions = new Map<string, Session>();
const COOKIE = "MCSID";

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    out[name] = decodeURIComponent(value);
  }
  return out;
}

export function createSession(user: string): string {
  const sid = randomBytes(16).toString("hex");
  sessions.set(sid, { user });
  return sid;
}

export function destroySession(sid?: string): void {
  if (sid) sessions.delete(sid);
}

export function getSession(req: Request): Session | undefined {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (!sid) return undefined;
  return sessions.get(sid);
}

export function setSessionCookie(res: Response, sid: string): void {
  res.setHeader("Set-Cookie", `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const session = getSession(req);
  if (!session) {
    res.redirect("/login");
    return;
  }
  next();
}
