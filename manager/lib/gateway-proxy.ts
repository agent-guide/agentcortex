// Module-level cached token, shared across requests via globalThis.
const g = globalThis as typeof globalThis & { __gatewayToken?: string };

function gatewayAddr(): string {
  return (process.env.GATEWAY_ADDR ?? "http://localhost:8080").replace(/\/$/, "");
}

function gatewayCredentials(): { user: string; pass: string } {
  return {
    user: process.env.GATEWAY_ADMIN_USER ?? "",
    pass: process.env.GATEWAY_ADMIN_PASSWORD ?? "",
  };
}

async function login(): Promise<string> {
  const { user, pass } = gatewayCredentials();
  const res = await fetch(`${gatewayAddr()}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`gateway login ${res.status}: ${raw.trim()}`);
  }
  const body = JSON.parse(raw) as { token?: string };
  if (!body.token) throw new Error("gateway login: missing token in response");
  g.__gatewayToken = body.token;
  return body.token;
}

async function getToken(): Promise<string> {
  if (g.__gatewayToken) return g.__gatewayToken;
  return login();
}

function invalidateToken(): void {
  g.__gatewayToken = undefined;
}

const SKIP_HEADERS = new Set([
  "authorization",
  "connection",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const SKIP_RESPONSE_HEADERS = new Set([
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-max-age",
]);

async function forwardOnce(
  req: Request,
  targetURL: string,
  token: string,
  body: ArrayBuffer,
): Promise<Response | null> {
  const outHeaders = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (!SKIP_HEADERS.has(k.toLowerCase())) outHeaders.set(k, v);
  }
  outHeaders.set("Authorization", `Bearer ${token}`);

  const upstream = await fetch(targetURL, {
    method: req.method,
    headers: outHeaders,
    body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
  });

  // Signal caller to retry on 401 without streaming
  if (upstream.status === 401) return null;

  const resHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (!SKIP_RESPONSE_HEADERS.has(k.toLowerCase())) resHeaders.set(k, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}

export async function proxyToGateway(req: Request, path: string): Promise<Response> {
  const { user } = gatewayCredentials();
  if (!user) {
    return Response.json({ error: "gateway proxy not configured: missing admin credentials" }, { status: 503 });
  }

  const url = new URL(req.url);
  const targetURL = `${gatewayAddr()}${path}${url.search}`;
  const body = await req.arrayBuffer();

  let token: string;
  try {
    token = await getToken();
  } catch (e) {
    return Response.json({ error: `gateway auth failed: ${String(e)}` }, { status: 502 });
  }

  let result = await forwardOnce(req, targetURL, token, body);
  if (result) return result;

  // 401 — stale token, re-login once
  invalidateToken();
  try {
    token = await login();
  } catch (e) {
    return Response.json({ error: `gateway re-auth failed: ${String(e)}` }, { status: 502 });
  }
  result = await forwardOnce(req, targetURL, token, body);
  if (!result) {
    return Response.json({ error: "gateway returned unauthorized after re-auth" }, { status: 502 });
  }
  return result;
}
