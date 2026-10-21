import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, apiUrl, cookieSecure } from "@/lib/session";

// Shared by the login and signup route handlers (app/api/auth/*).

export type TokenResponse = { access_token: string; token_type: string; expires_at: number };

export type Failure = { ok: false; status: number; code: string; detail: string };

export type Outcome = { ok: true; username: string; token: TokenResponse } | Failure;

export async function authenticate(username: string, password: string): Promise<Outcome> {
  if (!username || !password) {
    return { ok: false, status: 400, code: "missing", detail: "Username and password are required" };
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl()}/api/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 502, code: "unavailable", detail: "SAR API is not reachable" };
  }
  if (upstream.status === 401) {
    return { ok: false, status: 401, code: "invalid", detail: "Invalid username or password" };
  }
  if (!upstream.ok) {
    return { ok: false, status: 502, code: "unavailable", detail: "Login failed" };
  }
  return { ok: true, username, token: (await upstream.json()) as TokenResponse };
}

export function setSession(response: NextResponse, token: TokenResponse) {
  const maxAge = Math.max(0, token.expires_at - Math.floor(Date.now() / 1000));
  response.cookies.set(SESSION_COOKIE, token.access_token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return response;
}

// Relative Location: behind a reverse proxy request.url may carry the
// internal host, the browser resolves a path against what it sees.
export function seeOther(location: string) {
  return new NextResponse(null, { status: 303, headers: { location } });
}

// A form post must come from this site (no login CSRF). fetch() with a JSON
// body cannot be sent cross-site without a CORS preflight, which is not served.
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function isFormPost(request: NextRequest): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
}

// username/password from a form post or a JSON body; null for a broken body
export async function readCredentials(
  request: NextRequest,
): Promise<{ username: string; password: string; form: FormData | null } | null> {
  if (isFormPost(request)) {
    const form = await request.formData();
    return {
      username: String(form.get("username") ?? "").trim(),
      password: String(form.get("password") ?? ""),
      form,
    };
  }
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return null;
  }
  return {
    username: typeof body.username === "string" ? body.username.trim() : "",
    password: typeof body.password === "string" ? body.password : "",
    form: null,
  };
}
