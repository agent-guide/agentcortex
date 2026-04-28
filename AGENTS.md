# AGENTS.md

## Project Overview

AgentCortex is a standalone project organized as three sibling subprojects: `caddy-runtime`, `manager`, and `plugins`.

## Subproject Relationship

- `caddy-runtime` is the main functional component. It is a Caddy runtime that bundles the Caddy Agent Gateway module from `~/github/agent-guide/caddy-agent-gateway/` into a runnable Caddy binary.
- `manager` is a full-stack management application built with Bun + Next.js + TypeScript. It helps users operate and manage `caddy-runtime` through a dedicated backend API and web UI.
- `plugins` contains extension plugins for `caddy-runtime`. These plugins add optional gateway- or runtime-related capabilities without changing the manager application.

Keep changes scoped to the subproject that owns the behavior you are changing, and avoid coupling runtime, plugin, and manager logic beyond their documented HTTP boundaries.

## Subprojects

### `caddy-runtime`

Purpose: custom Caddy Server distribution that bundles AgentCortex-related Caddy modules into one runnable Caddy binary.

Responsibilities:
- Build the Caddy entrypoint (`cmd/caddy/main.go`).
- Register Caddy modules through blank imports.
- Integrate local or released Caddy modules such as the agent-gateway module from `~/github/agent-guide/caddy-agent-gateway/`.
- Serve as the primary runtime component used by end users and managed by `manager`.

Boundaries:
- Do not put management API orchestration here; that belongs in `manager/`.
- Do not put web UI code here; that belongs in `manager/`.
- Changes to gateway business behavior should be made in the module repo, then consumed here through `go.mod`.

Tech stack: Go, Caddy v2.

Useful commands:
```bash
go mod tidy
go build ./cmd/caddy
```

### `plugins`

Purpose: optional Caddy module plugins that extend `caddy-runtime` and the gateway (for example provider adapters or payment integrations).

Responsibilities:
- Each plugin is a standalone Go module that registers one or more Caddy modules via `init()`.
- Plugins are consumed by `caddy-runtime` via `go.mod` dependencies or `replace` directives.

Boundaries:
- Do not import `manager/` code; plugins only implement Caddy module interfaces.

### `manager`

Purpose: full-stack management application built with Bun + Next.js + TypeScript for operating and managing `caddy-runtime`.

Responsibilities:
- **Backend API** (Next.js Route Handlers under `app/api/`): authenticate manager users, manage Caddy servers and routes through the Caddy admin API, proxy remaining `/admin/*` requests to the gateway admin API.
- **Frontend UI** (Next.js App Router pages): login, dashboard, provider management, credential management, route and server administration.
- Provide the main user-facing management surface for the runtime, while keeping runtime behavior inside `caddy-runtime`.

Boundaries:
- Backend API routes own orchestration and auth for the management layer; they do not implement Caddy modules.
- Frontend pages do not call the Caddy admin API directly; they go through the backend API routes.
- The frontend does not talk directly to `caddy-runtime`; it uses the backend API as the boundary.
- When changing an API route shape, update the corresponding frontend helper types in `lib/`.

See `manager/CLAUDE.md` for detailed build commands and architecture.

## Cross-Project Guidance

- Preserve project boundaries: Caddy runtime in `caddy-runtime/`, plugins in `plugins/`, management API and UI in `manager/`.
- Keep HTTP contracts explicit: when changing an API in `manager/app/api/`, update the corresponding frontend helper/types in `manager/lib/`.
- For local Caddy module development, prefer `replace` directives in `caddy-runtime/go.mod` rather than copying code between projects.
- Run the narrowest relevant verification command before handing off changes.
- All text in code (descriptions, prompts, comments, command strings) must be in English.
