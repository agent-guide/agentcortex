import { API_BASE_URL, clearSession, getToken } from "./auth";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fetch wrapper for authenticated admin API calls.
 * Automatically injects the Bearer session token.
 * On 401, clears the session and redirects to /login.
 * Paths starting with /admin/ are proxied via /api/admin/.
 */
export async function adminFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = path.startsWith("/admin/")
    ? `${API_BASE_URL}/api${path}`
    : `${API_BASE_URL}${path}`;

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && token) {
    clearSession();
    if (typeof window !== "undefined") {
      window.location.replace("/login");
    }
    throw new ApiError(401, "Session expired");
  }

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, msg);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Unauthenticated POST for the login endpoint.
 */
export async function login(
  username: string,
  password: string,
): Promise<{ token: string; username: string }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  let msg = res.statusText;
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, msg);
  }

  return res.json() as Promise<{ token: string; username: string }>;
}

// ---- Provider types ----

export interface ProviderTypeItem {
  provider_type: string;
  enabled: boolean;
}

export interface ProviderItem {
  id: string;
  provider_type: string;
  api_key?: string;
  base_url?: string;
  default_model?: string;
  options?: Record<string, unknown>;
  read_only?: boolean;
}

// ---- Provider API functions ----

export async function listProviderTypes(): Promise<ProviderTypeItem[]> {
  const res = await adminFetch<{ items: ProviderTypeItem[] }>("/admin/provider_types");
  return res.items ?? [];
}

export async function enableProviderType(providerType: string): Promise<void> {
  await adminFetch(`/admin/provider_types/${encodeURIComponent(providerType)}/enable`, { method: "POST" });
}

export async function disableProviderType(providerType: string): Promise<void> {
  await adminFetch(`/admin/provider_types/${encodeURIComponent(providerType)}/disable`, { method: "POST" });
}

export async function listProviders(providerType?: string): Promise<ProviderItem[]> {
  const query = providerType ? `?provider_type=${encodeURIComponent(providerType)}` : "";
  const res = await adminFetch<{ items: ProviderItem[] }>(`/admin/providers${query}`);
  return res.items ?? [];
}

export async function createProvider(payload: {
  id: string;
  provider_type: string;
  api_key?: string;
  base_url?: string;
  default_model?: string;
}): Promise<ProviderItem> {
  return adminFetch<ProviderItem>("/admin/providers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateProvider(
  id: string,
  payload: {
    provider_type: string;
    api_key?: string;
    base_url?: string;
    default_model?: string;
  },
): Promise<ProviderItem> {
  return adminFetch<ProviderItem>(`/admin/providers/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ id, ...payload }),
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await adminFetch(`/admin/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ---- Credential types ----

export interface CredentialItem {
  id: string;
  provider_type: string;
  provider_id?: string;
  source: string;
  label?: string;
  attributes?: Record<string, string>;
  disabled?: boolean;
  unavailable?: boolean;
  read_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface CredentialCreatePayload {
  provider_id: string;
  label?: string;
  attributes?: Record<string, string>;
}

export interface CredentialUpdatePayload {
  label?: string;
  attributes?: Record<string, string>;
  disabled?: boolean;
}

// ---- Credential API functions ----

export async function listCredentials(params?: { provider_type?: string; source?: string }): Promise<CredentialItem[]> {
  const query = new URLSearchParams();
  if (params?.provider_type) query.set("provider_type", params.provider_type);
  if (params?.source) query.set("source", params.source);
  const qs = query.toString() ? `?${query.toString()}` : "";
  const res = await adminFetch<{ items: CredentialItem[] }>(`/admin/credentials${qs}`);
  return res.items ?? [];
}

export async function createCredential(payload: CredentialCreatePayload): Promise<CredentialItem> {
  return adminFetch<CredentialItem>("/admin/credentials", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCredential(id: string, payload: CredentialUpdatePayload): Promise<CredentialItem> {
  return adminFetch<CredentialItem>(`/admin/credentials/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteCredential(id: string): Promise<void> {
  await adminFetch(`/admin/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- CLI Auth Authenticator types ----

export type AuthenticatorSource = "caddyfile" | "runtime";

export interface NetworkConfig {
  request_timeout_seconds?: number;
  max_retries?: number;
  retry_delay_seconds?: number;
  max_idle_connections?: number;
  max_idle_connections_per_host?: number;
  idle_keep_alive_timeout_seconds?: number;
  proxy_url?: string;
  extra_headers?: Record<string, string>;
}

export interface AuthenticatorConfig {
  callback_port?: number;
  no_browser?: boolean;
  device_flow?: boolean;
  network?: NetworkConfig;
}

export interface AuthenticatorState {
  name: string;
  provider_type?: string;
  source?: AuthenticatorSource;
  read_only: boolean;
  enabled: boolean;
  config: AuthenticatorConfig;
}

// ---- CLI Auth Authenticator API functions ----

export async function listCLIAuthAuthenticators(): Promise<AuthenticatorState[]> {
  const res = await adminFetch<{ items: AuthenticatorState[] }>("/admin/cliauth/authenticators");
  return res.items ?? [];
}

export async function enableCLIAuthAuthenticator(
  name: string,
  config?: AuthenticatorConfig,
): Promise<{ status: string; authenticator: AuthenticatorState }> {
  return adminFetch(`/admin/cliauth/authenticators/${encodeURIComponent(name)}/enable`, {
    method: "POST",
    body: JSON.stringify({ config: config ?? {} }),
  });
}

export async function disableCLIAuthAuthenticator(
  name: string,
): Promise<{ status: string; authenticator_name: string }> {
  return adminFetch(`/admin/cliauth/authenticators/${encodeURIComponent(name)}/disable`, {
    method: "POST",
  });
}

// ---- CLI Auth Refresher types ----

export interface CLIAuthRefresherStatus {
  enabled: boolean;
}

// ---- CLI Auth Refresher API functions ----

export async function getCLIAuthRefresherStatus(): Promise<CLIAuthRefresherStatus> {
  return adminFetch<CLIAuthRefresherStatus>("/admin/cliauth/refresher");
}

export async function enableCLIAuthRefresher(): Promise<{ status: string; enabled: boolean }> {
  return adminFetch("/admin/cliauth/refresher/enable", { method: "POST" });
}

export async function disableCLIAuthRefresher(): Promise<{ status: string; enabled: boolean }> {
  return adminFetch("/admin/cliauth/refresher/disable", { method: "POST" });
}

// ---- CLI Auth Login types ----

export interface CLIAuthLoginStartResponse {
  login_id: string;
  status: string;
  authenticator_name: string;
  message: string;
}

export interface CLIAuthLoginStatus {
  login_id: string;
  authenticator_name: string;
  status: string; // "running" | "succeeded" | "failed"
  started_at: string;
  finished_at?: string;
  phase?: string;
  message?: string;
  verification_url?: string;
  user_code?: string;
  error?: string;
  credential_id?: string;
}

// ---- CLI Auth Login API functions ----

export async function startCLIAuthLogin(
  authenticatorName: string,
  payload?: { provider_id?: string },
): Promise<CLIAuthLoginStartResponse> {
  return adminFetch<CLIAuthLoginStartResponse>(
    `/admin/cliauth/authenticators/${encodeURIComponent(authenticatorName)}/login`,
    { method: "POST", body: payload ? JSON.stringify(payload) : undefined },
  );
}

export async function getCLIAuthLoginStatus(loginId: string): Promise<CLIAuthLoginStatus> {
  return adminFetch<CLIAuthLoginStatus>(`/admin/cliauth/logins/${encodeURIComponent(loginId)}`);
}
