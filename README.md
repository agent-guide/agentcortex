# AgentCortex

AgentCortex is a self-hosted AI gateway platform built on [Caddy](https://caddyserver.com/). It routes LLM API requests across multiple providers, enforces API key policies, and exposes a web UI for administration — all in a single deployable stack.

## Architecture

```
agentcortex/
├── caddy-runtime/   ← Custom Caddy binary with agent gateway modules bundled
├── manager/         ← Web UI + backend API for operating caddy-runtime (Bun + Next.js)
└── plugins/         ← Optional Caddy module plugins (provider adapters, payment integrations)
```

**caddy-runtime** is the core component. It runs the Caddy server with the `agent_gateway` app module, the `agent_route_dispatcher` HTTP handler, and any plugins registered at build time.

**manager** is the control plane. It talks to caddy-runtime through the Caddy admin API and the gateway admin API, and exposes a dashboard at `http://localhost:3000`.

**plugins** extend runtime capabilities (e.g. x402 payment gating) without modifying the manager.

## Features

- Multi-provider LLM routing: OpenAI, Anthropic, Gemini, Ollama, OpenRouter, and more
- Provider abstraction: configure multiple providers, each with their own API key and base URL
- Virtual API keys: issue scoped local keys with per-route and per-model restrictions
- Route management: define named routes with path prefix, allowed models, and target provider
- SQLite-backed config store (persistent, no external database required)
- Web dashboard: manage servers, routes, providers, credentials, and usage
- Gateway admin API proxy: the manager proxies `/api/admin/*` requests to the gateway admin API

## Prerequisites

| Component | Requirement |
|-----------|-------------|
| caddy-runtime | Go 1.21+ |
| manager | Bun 1.x |

## Quick Start

### 1. Build caddy-runtime

```bash
cd caddy-runtime
go mod tidy
go build -o caddy-runtime ./cmd/caddy/main.go
```

### 2. Configure and run caddy-runtime

Copy the example Caddyfile and adjust it for your environment:

```bash
cp Caddyfile.example Caddyfile
# Edit Caddyfile: set provider API keys, ports, routes, etc.
./caddy-runtime run --config Caddyfile
```

By default caddy-runtime listens on:
- `:2019` — Caddy admin API
- `:8081` — Gateway admin API (`/admin/*`)
- `:8082` — LLM API proxy (agent route dispatcher)

### 3. Configure and run manager

```bash
cd manager
bun install
```

Create `manager/.env.local`:

```bash
# Admin credentials for the manager UI
CADDYMGR_ADMIN_USER=admin
CADDYMGR_ADMIN_PASSWORD_HASH=<bcrypt hash>   # see below

# Caddy admin API address
CADDY_ADMIN_ADDR=http://localhost:2019

# Gateway admin API address
GATEWAY_ADDR=http://localhost:8081
GATEWAY_ADMIN_USER=<gateway admin user>
GATEWAY_ADMIN_PASSWORD=<gateway admin password>
```

Generate a bcrypt password hash:

```bash
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('yourpassword', 10).then(console.log)"
```

Start the development server:

```bash
bun run dev        # http://localhost:3000
```

Or build and run in production:

```bash
bun run build
bun run start
```

## Caddyfile Reference

The `caddy-runtime/Caddyfile.example` shows how to wire up the gateway:

```caddyfile
{
    agent_gateway {
        config_store sqlite { path ./data/configstore.db }

        provider my-provider {
            provider_name openai
            api_key {$OPENAI_API_KEY}
            base_url https://api.openai.com/v1
        }

        localapikey my-key {
            user_id alice
            name "Alice dev key"
            allowed_route my-route
        }

        route my-route {
            llm_api openai
            path_prefix /
            require_local_api_key
            allowed_model gpt-4o
            target provider my-provider
        }
    }
}

http://127.0.0.1:8081 {
    route /admin/* {
        agent_gateway_admin {
            admin_user default
            admin_password_hash <bcrypt hash>
        }
    }
}

http://127.0.0.1:8082 {
    agent_route_dispatcher {
        llm_api openai
        llm_api anthropic
    }
}
```

## Subproject Documentation

- [`caddy-runtime/`](caddy-runtime/) — build commands, Go module structure
- [`manager/README.md`](manager/README.md) — full API reference, configuration, architecture
- [`plugins/`](plugins/) — plugin development guide

## License

Apache License 2.0. See [LICENSE](LICENSE).
