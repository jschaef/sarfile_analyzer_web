import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/redirect";
import { SESSION_COOKIE, apiUrl, cookieSecure } from "@/lib/session";

type TokenResponse = { access_token: string; token_type: string; expires_at: number };

type Outcome =
  | { ok: true; username: string; token: TokenResponse }
  | { ok: false; status: number; code: "missing" | "invalid" | "unavailable"; detail: string };

async function authenticate(username: string, password: string): Promise<Outcome> {
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

function setSession(response: NextResponse, token: TokenResponse) {
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
function seeOther(location: string) {
  return new NextResponse(null, { status: 303, headers: { location } });
}

// A form post must come from this site (no login CSRF). fetch() with a JSON
// body cannot be sent cross-site without a CORS preflight, which is not served.
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Exchanges username/password for an API token and keeps it in an httpOnly
// cookie; the token is never part of a response body. Two callers:
// - the login form via fetch (JSON in, JSON out)
// - the same form posted natively when JavaScript is not running
//   (form data in, 303 redirect out)
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    if (!sameOrigin(request)) {
      return NextResponse.json({ detail: "Cross-site login rejected" }, { status: 403 });
    }
    const form = await request.formData();
    const next = safeNext(String(form.get("next") ?? ""));
    const outcome = await authenticate(String(form.get("username") ?? "").trim(), String(form.get("password") ?? ""));
    if (!outcome.ok) {
      const query = new URLSearchParams({ error: outcome.code, next });
      return seeOther(`/login?${query}`);
    }
    return setSession(seeOther(next), outcome.token);
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid request" }, { status: 400 });
  }
  const outcome = await authenticate(
    typeof body.username === "string" ? body.username.trim() : "",
    typeof body.password === "string" ? body.password : "",
  );
  if (!outcome.ok) {
    return NextResponse.json({ detail: outcome.detail }, { status: outcome.status });
  }
  return setSession(NextResponse.json({ username: outcome.username }), outcome.token);
}
