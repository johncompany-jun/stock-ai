import type { MiddlewareHandler } from "hono";

const COOKIE_NAME = "sa_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

type Env = {
  OWNER_PASSWORD?: string;
  SESSION_SECRET?: string;
};

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const importHmacKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

export const timingSafeEqualStr = (a: string, b: string): boolean => {
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(a), enc.encode(b));
};

export const signSession = async (secret: string): Promise<string> => {
  const payload = { sub: "owner", exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC };
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64url(sig)}`;
};

export const verifySession = async (
  token: string | undefined,
  secret: string,
): Promise<boolean> => {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  const key = await importHmacKey(secret);
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)),
  );
  const given = b64urlDecode(sigB64);
  if (!timingSafeEqual(expected, given)) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as {
      sub?: string;
      exp?: number;
    };
    if (payload.sub !== "owner") return false;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
};

export const readCookie = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
};

export const sessionCookie = (value: string): string =>
  `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SEC}`;

export const clearCookie = (): string =>
  `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export const isAuthenticated = async (
  cookieHeader: string | undefined,
  env: Env,
): Promise<boolean> => {
  if (!env.SESSION_SECRET) return false;
  const token = readCookie(cookieHeader, COOKIE_NAME);
  return verifySession(token, env.SESSION_SECRET);
};

export const requireOwner = (): MiddlewareHandler<{ Bindings: Env }> => async (c, next) => {
  const ok = await isAuthenticated(c.req.header("cookie"), c.env);
  if (!ok) return c.json({ error: "unauthorized" }, 401);
  await next();
};

export const COOKIE = { name: COOKIE_NAME, maxAge: MAX_AGE_SEC };
