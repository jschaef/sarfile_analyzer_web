import { NextResponse, type NextRequest } from "next/server";
import { authenticate, readCredentials, sameOrigin, seeOther, setSession } from "@/lib/auth-route";
import { safeNext } from "@/lib/redirect";

// Exchanges username/password for an API token and keeps it in an httpOnly
// cookie; the token is never part of a response body. Two callers:
// - the login form via fetch (JSON in, JSON out)
// - the same form posted natively when JavaScript is not running
//   (form data in, 303 redirect out)
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ detail: "Cross-site login rejected" }, { status: 403 });
  }
  const credentials = await readCredentials(request);
  if (!credentials) return NextResponse.json({ detail: "Invalid request" }, { status: 400 });
  const { username, password, form } = credentials;
  const outcome = await authenticate(username, password);

  if (form) {
    const next = safeNext(String(form.get("next") ?? ""));
    if (!outcome.ok) return seeOther(`/login?${new URLSearchParams({ error: outcome.code, next })}`);
    return setSession(seeOther(next), outcome.token);
  }
  if (!outcome.ok) return NextResponse.json({ detail: outcome.detail }, { status: outcome.status });
  return setSession(NextResponse.json({ username: outcome.username }), outcome.token);
}
