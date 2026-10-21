// Shared by proxy.ts and the route handlers. Server-only values: the token
// lives in an httpOnly cookie and is never readable from browser JavaScript.

export const SESSION_COOKIE = "sar_session";

// sar-web-api (backend/), see next.config.ts
export function apiUrl(): string {
  return (process.env.SAR_WEB_API_URL ?? "http://127.0.0.1:8200").replace(/\/$/, "");
}

// Secure cookies need HTTPS. Default: on in production builds, overridable
// for plain-HTTP lab setups with SAR_COOKIE_SECURE=false.
export function cookieSecure(): boolean {
  const flag = process.env.SAR_COOKIE_SECURE;
  if (flag !== undefined) return flag === "true" || flag === "1";
  return process.env.NODE_ENV === "production";
}
