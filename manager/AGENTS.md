@AGENTS.md

# manager

This directory is a Bun + Next.js + TypeScript full-stack management application for AgentCortex.

It exists to help users operate and manage `caddy-runtime`, which is the main runtime component of this repository. The manager provides both:

- a backend API implemented with Next.js Route Handlers under `app/api/`
- a frontend dashboard implemented with the Next.js App Router

## Build and Run

```bash
# Install dependencies
bun install

# Start development server (port 3000)
bun run dev

# Production build
bun run build

# Start production server
bun run start

# Lint
bun run lint
```

The backend API and frontend are served from the same Next.js process on the same port. There is no separate API server.

## Tech Stack

- **Runtime**: Bun
- **Framework**: Next.js 16.2.4 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Data fetching**: SWR
- **Charts**: Recharts

## Architecture

```
manager/
├── app/
│   ├── api/              ← Backend: Route Handlers for manager APIs and runtime orchestration
│   │   ├── auth/         ← POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
│   │   ├── caddy/        ← Caddy server/route management endpoints
│   │   └── admin/        ← Proxy catch-all to caddy-runtime gateway admin API
│   └── (dashboard)/      ← Frontend: App Router pages for runtime management
│       ├── dashboard/
│       ├── login/
│       └── ...
├── components/           ← Shared UI components
├── hooks/                ← Custom React hooks
└── lib/
    ├── api.ts            ← Typed fetch helpers for backend API calls (frontend side)
    ├── auth.ts           ← localStorage session helpers (token, username)
    ├── caddy-manager.ts  ← Caddy admin API client for caddy-runtime management
    └── gateway-proxy.ts  ← Gateway admin API proxy with session caching
```

## Relationship To Other Subprojects

- `manager` does not implement Caddy modules. Runtime behavior belongs in `caddy-runtime` or in `plugins`.
- `manager` talks to `caddy-runtime` through the Caddy admin API and the gateway admin API.
- `plugins` extend runtime capabilities. If the UI or manager API needs to expose a new plugin-backed capability, keep the runtime/plugin implementation and manager integration clearly separated by HTTP contracts and typed request/response helpers.

## Backend API (Route Handlers)

Route Handlers run on the server. Implement them under `app/api/`.

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Validate username + bcrypt password, return Bearer token |
| POST | `/api/auth/logout` | Revoke session token |
| GET | `/api/auth/me` | Return session info |

Session tokens are random hex strings stored in an in-process `Map`. Use `Authorization: Bearer <token>` on all protected routes. Authenticate with `requireAuth()` middleware in each handler.

Configuration via environment variables:
- `CADDYMGR_ADMIN_USER` — admin username
- `CADDYMGR_ADMIN_PASSWORD_HASH` — bcrypt hash of admin password
- `CADDY_ADMIN_ADDR` — Caddy admin API address (default `http://localhost:2019`)
- `GATEWAY_ADDR` — gateway admin API address (default `http://localhost:8080`)
- `GATEWAY_ADMIN_USER` / `GATEWAY_ADMIN_PASSWORD` — gateway proxy credentials
- `CADDYMGR_READONLY_SERVER_IDS` — comma-separated Caddy server IDs that are read-only

### Caddy Server and Route Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/caddy/servers` | List Caddy HTTP servers |
| POST | `/api/caddy/servers` | Create a server |
| GET | `/api/caddy/servers/[id]` | Get a server |
| PUT | `/api/caddy/servers/[id]` | Update a server |
| DELETE | `/api/caddy/servers/[id]` | Delete a server |
| GET | `/api/caddy/servers/[id]/routes` | List routes for a server |
| POST | `/api/caddy/servers/[id]/routes` | Add a route |
| PUT | `/api/caddy/servers/[id]/routes/[routeId]` | Update a route |
| DELETE | `/api/caddy/servers/[id]/routes/[routeId]` | Delete a route |

These endpoints translate between the manager's simplified `ServerRequest`/`RouteRequest` types and Caddy's internal JSON config format. Key rules:
- Servers listed in `CADDYMGR_READONLY_SERVER_IDS`, or whose routes contain `agent_gateway_admin` handlers, or whose routes lack a `group` field (Caddyfile-defined), are read-only — return 403.
- Mutations use a get-modify-post cycle against `GET /config/` + `POST /config/` on the Caddy admin API. Only paths under `/apps/http/servers` are allowed.

### Gateway Proxy Catch-All

Any `/api/admin/` request not matched by a more-specific handler is proxied to the gateway admin API at `GATEWAY_ADDR`. The proxy:
1. Authenticates to the gateway with `GATEWAY_ADMIN_USER`/`GATEWAY_ADMIN_PASSWORD` once and caches the token.
2. On 401 from the gateway, invalidates the cached token, re-logs in, and retries once.
3. Strips and replaces the `Authorization` header with the gateway token before forwarding.

## Frontend (App Router Pages)

The entry route (`/`) redirects to `/dashboard`.

Key frontend conventions:
- `lib/auth.ts`: `localStorage` helpers — `getToken()`, `saveSession()`, `clearSession()`, `isAuthenticated()`.
- `lib/api.ts`: typed `adminFetch<T>()` wrapper that injects `Authorization: Bearer <token>`, and on 401 clears the session and redirects to `/login`.
- `NEXT_PUBLIC_API_BASE_URL` env var sets the API base URL (default `http://localhost:8080` for compatibility; in this project the backend and frontend are co-hosted so set it to an empty string or omit).
- UI uses `components/auth-guard.tsx` to protect dashboard routes.
- Navigation structure should reflect the manager's current runtime-management features (for example Overview, Routes, Providers, Models, Credentials, Virtual Keys, Usage, Gateway, Servers).

## Key Types

```typescript
// Shared between frontend and backend API handlers — put in lib/types.ts

interface ServerRequest { id: string; listen: string[]; tls?: TLSConf }
interface TLSConf { auto?: boolean; cert_file?: string; key_file?: string }
interface ServerResponse { id: string; listen: string[]; routes?: RouteResponse[]; readonly?: boolean; source?: string; public_url?: string }

interface RouteRequest { id: string; order: number; match: MatchConf; handlers: HandlerConf[] }
interface MatchConf { paths?: string[]; hosts?: string[] }
interface HandlerConf { type: string; apis?: string[]; upstream?: string; root?: string }
interface RouteResponse { id: string; order: number; match: MatchConf; handlers: HandlerConf[] }
```

## Error Handling

Backend handlers return `{ error: string }` JSON on failure with the appropriate HTTP status:
- 400 Bad Request — invalid input
- 401 Unauthorized — not authenticated
- 403 Forbidden — read-only resource
- 404 Not Found — resource does not exist
- 409 Conflict — resource already exists
- 502 Bad Gateway — Caddy admin or gateway unreachable
- 500 Internal Server Error — unexpected failure
