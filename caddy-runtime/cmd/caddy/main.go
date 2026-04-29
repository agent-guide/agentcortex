package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	_ "github.com/agent-guide/agentcortex/plugins/caddy-provider-zhipuac"
	_ "github.com/agent-guide/caddy-agent-gateway/admin"
	_ "github.com/agent-guide/caddy-agent-gateway/cliauth/authenticator"
	_ "github.com/agent-guide/caddy-agent-gateway/dispatcher"
	_ "github.com/agent-guide/caddy-agent-gateway/dispatcher/llmapi/anthropic"
	_ "github.com/agent-guide/caddy-agent-gateway/dispatcher/llmapi/openai"
	_ "github.com/agent-guide/caddy-agent-gateway/gateway"
	_ "github.com/agent-guide/caddy-agent-gateway/llm/provider/anthropic"
	_ "github.com/agent-guide/caddy-agent-gateway/llm/provider/gemini"
	_ "github.com/agent-guide/caddy-agent-gateway/llm/provider/ollama"
	_ "github.com/agent-guide/caddy-agent-gateway/llm/provider/openai"
	_ "github.com/agent-guide/caddy-agent-gateway/llm/provider/openrouter"
	_ "github.com/agent-guide/caddy-agent-gateway/llm/provider/zhipu"
	_ "github.com/agent-guide/caddy-x402pay"
	_ "github.com/caddyserver/caddy/v2/modules/standard"
)

func main() {
	caddycmd.Main()
}
