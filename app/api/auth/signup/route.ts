import { NextResponse, type NextRequest } from "next/server";
import { authenticate, readCredentials, sameOrigin, seeOther, setSession } from "@/lib/auth-route";
import { apiUrl } from "@/lib/session";

// Creates the account at sar-web-api and logs the new user in (cookie as in
// the login route). JSON in/out for the form's fetch, 303 redirects for the
// form posted without JavaScript.
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ detail: "Cross-site signup rejected" }, { status: 403 });
  }
  const credentials = await readCredentials(request);
  if (!credentials) return NextResponse.json({ detail: "Invalid request" }, { status: 400 });
  const { username, password, form } = credentials;

  const fail = (status: number, detail: string) =>
    form
      ? seeOther(`/signup?${new URLSearchParams({ error: detail })}`)
      : NextResponse.json({ detail }, { status });

  if (form && form.get("password") !== form.get("repeat")) return fail(400, "The passwords do not match");
  if (!username || !password) return fail(400, "Username and password are required");

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl()}/api/v2/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
  } catch {
    return fail(502, "SAR API is not reachable");
  }
  if (!upstream.ok) {
    const body = await upstream.json().catch(() => ({}));
    // 422: pydantic's field errors (e.g. a name longer than 50 characters)
    const detail = typeof body?.detail === "string" ? body.detail : "Invalid username or password";
    return fail(upstream.status === 422 ? 400 : upstream.status, detail);
  }

  const outcome = await authenticate(username, password);
  if (!outcome.ok) return form ? seeOther("/login") : NextResponse.json({ created: true }, { status: 201 });
  return setSession(form ? seeOther("/overview") : NextResponse.json({ username }, { status: 201 }), outcome.token);
}
