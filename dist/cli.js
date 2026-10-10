#!/usr/bin/env node
import * as path from "node:path";
import { loadConfig } from "./config/index.js";
import { Supervisor } from "./supervisor/runner.js";
function printHelp() {
    console.log(`
LocalTool Bridge: Redundant MCP & WebSocket bridge for LM Studio agent delegation

Usage:
  localtool [command] [options]

Commands:
  start                     Start the bridge (default)
  setup-claude              Print instructions and config for Claude Code
  setup-antigravity         Print instructions and config for Antigravity
  help                      Print this help message

Options:
  --lan                     Enable LAN mode (bind 0.0.0.0) [default: localhost 127.0.0.1]
  --host <ip>               Specific host address to bind to
  --ws-port <port>          WebSocket server port [default: 3334]
  --mcp-mode <stdio|none>   MCP transport mode [default: stdio]
  --lmstudio-url <url>      LM Studio API endpoint [default: http://127.0.0.1:1234]
  --model <model_id>        Default LM Studio model
  --token <secret>          Bearer token for WebSocket authentication
  --allow-dir <path>        Add allowed root directory for file ops (can be specified multiple times)
  --disable-shell           Disable shell_exec tool for extra sandboxing

Environment Variables:
  LOCALTOOL_LAN=true        Enable LAN mode
  LMSTUDIO_URL=...          LM Studio endpoint
  LOCALTOOL_MODEL=...       Default model
  LOCALTOOL_WS_PORT=...     WebSocket port
  LOCALTOOL_AUTH_TOKEN=...  WebSocket auth token
`);
}
function printClaudeConfig() {
    const cliPath = path.resolve(process.argv[1]);
    console.log(`
=== Claude Code MCP Configuration ===

To add LocalTool to Claude Code, run this command in your terminal:

claude mcp add localtool -- node "${cliPath}"

Or add this to your claude.json / claude_desktop_config.json:
{
  "mcpServers": {
    "localtool": {
      "command": "node",
      "args": ["${cliPath}"],
      "env": {
        "LMSTUDIO_URL": "http://127.0.0.1:1234"
      }
    }
  }
}
`);
}
function printAntigravityConfig() {
    const cliPath = path.resolve(process.argv[1]);
    console.log(`
=== Antigravity MCP Configuration ===

Add the following to your Antigravity MCP configuration:

{
  "mcpServers": {
    "localtool": {
      "command": "node",
      "args": ["${cliPath}"],
      "env": {
        "LMSTUDIO_URL": "http://127.0.0.1:1234"
      }
    }
  }
}

Redundant WebSocket fallback URL:
ws://127.0.0.1:3334?token=localtool-secret-token
`);
}
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] && !args[0].startsWith("-") ? args[0] : "start";
    if (command === "help" || args.includes("--help") || args.includes("-h")) {
        printHelp();
        return;
    }
    if (command === "setup-claude") {
        printClaudeConfig();
        return;
    }
    if (command === "setup-antigravity") {
        printAntigravityConfig();
        return;
    }
    // Parse command line arguments
    const overrides = {};
    const allowedRoots = [];
    let mcpMode = "stdio";
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--lan") {
            overrides.listenLan = true;
            overrides.host = "0.0.0.0";
        }
        else if (arg === "--host" && args[i + 1]) {
            overrides.host = args[++i];
        }
        else if (arg === "--ws-port" && args[i + 1]) {
            overrides.wsPort = parseInt(args[++i], 10);
        }
        else if (arg === "--lmstudio-url" && args[i + 1]) {
            overrides.lmStudioUrl = args[++i];
        }
        else if (arg === "--model" && args[i + 1]) {
            overrides.defaultModel = args[++i];
        }
        else if (arg === "--token" && args[i + 1]) {
            overrides.authToken = args[++i];
        }
        else if (arg === "--allow-dir" && args[i + 1]) {
            allowedRoots.push(path.resolve(args[++i]));
        }
        else if (arg === "--disable-shell") {
            overrides.shellEnabled = false;
        }
        else if (arg === "--mcp-mode" && args[i + 1]) {
            mcpMode = args[++i];
        }
    }
    if (allowedRoots.length > 0) {
        overrides.allowedRoots = allowedRoots;
    }
    const config = loadConfig(overrides);
    const supervisor = new Supervisor(config);
    await supervisor.start({
        enableMcpStdio: mcpMode === "stdio",
        enableWs: true
    });
}
main().catch((err) => {
    console.error("[LocalTool Bridge] Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map