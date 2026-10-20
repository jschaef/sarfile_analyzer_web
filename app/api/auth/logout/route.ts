import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, apiUrl, cookieSecure } from "@/lib/session";

// Revokes the token at sar-web-api (it is rejected from then on, even if it
// was copied) and drops the cookie. The cookie goes in any case, also when the
// API is unreachable or the token already expired.
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let revoked = false;
  if (token) {
    try {
      const upstream = await fetch(`${apiUrl()}/api/v2/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      revoked = upstream.ok;
    } catch {
      revoked = false;
    }
  }
  const response = NextResponse.json({ ok: true, revoked });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
