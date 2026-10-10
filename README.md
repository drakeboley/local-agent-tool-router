# LocalTool Bridge

A local **Model Context Protocol (MCP)** server with a **redundant WebSocket JSON-RPC server** — both connected to a locally running **LM Studio** instance — enabling agents to delegate tool execution, shell commands, and file operations to a local worker agent.

---

## Architecture Overview

```
+-----------------------------------------------------------+
|              Primary Agent (Antigravity / Claude Code)    |
+-----------------------------------------------------------+
        |                                        |
        | Primary (stdio / HTTP)                 | Redundant Failover (ws://)
        v                                        v
+-----------------------+              +-----------------------+
|      MCP Server       |              |   WebSocket Server    |
| (Model Context Proto) |              |  (JSON-RPC 2.0 / SSE) |
+-----------------------+              +-----------------------+
        \                                      /
         +------------------+-----------------+
                            |
                            v
       +---------------------------------------------+
       |           Shared LocalTool Core             |
       |  - Unified SQLite Job & Audit Store         |
       |  - Idempotency & De-duplication             |
       |  - Path Security & Workspace Sandbox        |
       |  - Tool Registry & Execution Engine         |
       +---------------------------------------------+
                            |
                            v
       +---------------------------------------------+
       |          Autonomous Worker Agent            |
       |  (Native Tool Calling + Fallback Parser)    |
       +---------------------------------------------+
                            |
                            v
+-----------------------------------------------------------+
|           LM Studio Instance (http://127.0.0.1:1234)      |
|  Supported Models:                                        |
|  * qwen/qwen3-coder-30b          * mistralai/devstral...  |
|  * mistralai/ministral-reasoning * openai/gpt-oss-20b     |
|  * liquid/lfm2.5-1.2b            * google/gemma-4-e4b     |
|  * essentialai/rnj-1             * prism-ml/bonsai-27b    |
|  * qwen/qwen3-30b-a3b-2507                                |
+-----------------------------------------------------------+
```

### Why Redundant Transports?
- **Shared Brain, Two Doors**: Both the MCP server and the WebSocket server access the **same underlying SQLite database** and tool registry.
- **Failover & Idempotency**: If the MCP connection drops or stutters, the primary agent can immediately fail over to WebSocket and submit or poll the same task using the same `idempotency_key`. The job state, logs, and results are shared.
- **LAN Flexibility**: The WebSocket server can listen locally (`127.0.0.1`) or broadcast to the LAN (`--lan`) with Bearer token authentication.

---

## Quick Start

### 1. Installation & Build

```bash
git clone <repo-url> localtool
cd localtool
npm install
npm run build
npm test
```

### 2. Start the Bridge

Start both MCP (stdio) and WebSocket (port 3334) on localhost:
```bash
node dist/cli.js start
```

Enable **LAN mode** (listens on `0.0.0.0` for network access):
```bash
node dist/cli.js start --lan --token "my-secure-token"
```

Configure custom options:
```bash
node dist/cli.js start \
  --lmstudio-url "http://127.0.0.1:1234" \
  --model "qwen/qwen3-coder-30b" \
  --ws-port 3334 \
  --allow-dir "/home/drake/myproject"
```

---

## Agent Configuration

### Antigravity Setup

Run:
```bash
node dist/cli.js setup-antigravity
```

Add to your Antigravity configuration:
```json
{
  "mcpServers": {
    "localtool": {
      "command": "node",
      "args": ["/home/drake/localtool/dist/cli.js"],
      "env": {
        "LMSTUDIO_URL": "http://127.0.0.1:1234"
      }
    }
  }
}
```

Redundant WebSocket fallback URL:
`ws://127.0.0.1:3334?token=localtool-secret-token`

### Claude Code Setup

Run:
```bash
node dist/cli.js setup-claude
```

Register LocalTool directly in Claude Code:
```bash
claude mcp add localtool -- node "/home/drake/localtool/dist/cli.js"
```

Or add to your `claude.json` / `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "localtool": {
      "command": "node",
      "args": ["/home/drake/localtool/dist/cli.js"],
      "env": {
        "LMSTUDIO_URL": "http://127.0.0.1:1234"
      }
    }
  }
}
```

---

## Available MCP & WebSocket Tools

### 1. `delegate_task`
Delegates a complex goal to the LM Studio worker agent. The worker autonomously plans and runs tool calls.
- `instruction` *(string, required)*: Goal description.
- `context` *(object, optional)*: Additional context.
- `model` *(string, optional)*: Specific LM Studio model to route to.
- `mode` *(string, optional)*: `"sync"` (wait for result) or `"async"` (return `job_id` immediately).
- `idempotency_key` *(string, optional)*: Deduplication key.
- `max_steps` *(number, optional)*: Max autonomous steps (default: 10).

### 2. `run_tool`
Direct, low-latency execution of a local tool without an LLM in the loop:
- `file_list` (`ls`): List files with size, type, modified time.
- `file_read` (`cat`): Read text file with line offsets and size cap.
- `file_write` (`write`): Write/append file with parent dir creation.
- `file_mkdir` (`mkdir -p`): Recursive folder creation.
- `file_delete` (`rm`): Safe file/directory removal (blocks root `/`).
- `file_search` (`find`/`grep`): Search by pattern or file content.
- `shell_exec` (`exec_cmd`): Execute shell command with timeout and output capture.

### 3. `get_job`
Inspect the status, step-by-step tool trace, and final output of an async job.

### 4. `cancel_job`
Cancel a currently executing delegated job.

### 5. `list_jobs`
List recent jobs and filter by status (`pending`, `running`, `completed`, `failed`).

### 6. `worker_health`
Inspect LM Studio connection, active models, and bridge status.

---

## Included Skills

The repository includes two specialized agent skills:

1. **`skills/local-tool-delegation/SKILL.md`**:
   - For **Antigravity** and **Claude Code**.
   - Guides the model on when to delegate (heavy file operations, multi-file refactoring, privacy-sensitive logs, large builds) and when to execute directly.
   - Contains model routing guidelines, failover instructions, and verification checklists.

2. **`skills/local-worker-agent/SKILL.md`**:
   - Injected into the **LM Studio local worker agent**.
   - Provides strict operational rules for tool calling, step-by-step planning, error self-correction, untrusted data handling, and prompt-injection defense.

---

## Security & Sandboxing

- **Workspace Boundaries**: All file operations and shell working directories are validated against `allowedRoots`. Any traversal outside (e.g. `../../etc/passwd`) is rejected with `Access Denied`.
- **Root Protection**: Deletion of the filesystem root (`/`) or current working directory is explicitly blocked.
- **Untrusted Input Guard**: Tool outputs are treated strictly as untrusted data by the worker agent.
- **Token Auth**: WebSocket connections require a Bearer token whenever communicating over the network or LAN.
- **Audit Logging**: Every tool execution is recorded in SQLite with timestamp, arguments, duration, and status. Inspect logs via MCP resource `localtool://audit`.
