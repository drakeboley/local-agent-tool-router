---
name: local-tool-delegation
description: >-
  Instructs models (Antigravity and Claude Code) how and when to delegate local
  tool calls to a local LM Studio worker agent via MCP and redundant WebSocket.
---

# Local Tool Delegation Guide

This skill teaches agents how to delegate local tool execution (file operations, shell commands, searches) to a local worker agent backed by **LM Studio**.

The local bridge provides two redundant transports sharing a persistent SQLite store:
1. **Primary Transport**: Model Context Protocol (MCP) server exposing `delegate_task`, `run_tool`, `get_job`, `cancel_job`, `list_jobs`, and `worker_health`.
2. **Redundant Transport**: WebSocket server (`ws://127.0.0.1:3334`) implementing the same JSON-RPC methods and real-time streaming notifications.

---

## 1. When to Delegate vs. When to Execute Directly

| Task Category | Recommendation | Rationale |
| :--- | :--- | :--- |
| **Multi-step file refactoring** | **Delegate** | Offloads repetitive read/write turns from cloud context window to local GPU. |
| **Scaffolding / directory creation** | **Delegate** | Fast local file I/O executed in one turn. |
| **Privacy-sensitive log analysis** | **Delegate** | Raw log files remain strictly on the local machine and are not sent to cloud APIs. |
| **Heavy shell builds or test runs** | **Delegate (async)** | Background execution avoids cloud agent timeout. |
| **High-stakes architectural planning** | **Do NOT delegate** | Frontier cloud models provide superior reasoning for system-level design. |
| **Single 1-line file read or edit** | **Do NOT delegate** | Directly calling `view_file` or `run_command` has lower latency than delegating. |

---

## 2. Model Selection Guide

When calling `delegate_task`, you can optionally specify the `model` parameter depending on the nature of the task. The local bridge supports and routes across the following LM Studio models:

| Model ID | Best For | Characteristics |
| :--- | :--- | :--- |
| `qwen/qwen3-coder-30b` | **Code generation, refactoring, tool calling** | Native function calling, excellent code syntax accuracy. *(Recommended Default)* |
| `mistralai/devstral-small-2-2512` | **Fast coding, git workflows, script generation** | High speed, strong instruction following. |
| `mistralai/ministral-3-14b-reasoning` | **Multi-step problem solving, debugging** | Chain-of-thought reasoning before tool invocation. |
| `qwen/qwen3-30b-a3b-2507` | **Complex file parsing, multilingual documentation** | Large context, robust extraction. |
| `openai/gpt-oss-20b` | **Balanced execution, summarization** | Reliable general tool usage. |
| `prism-ml/bonsai-27b` | **Analytical pipelines, code review** | Strong structured output compliance. |
| `google/gemma-4-e4b` | **Lightweight checks, linting, quick search** | Low VRAM footprint, fast response. |
| `liquid/lfm2.5-1.2b` | **Minimal subtasks, simple string extraction** | Ultra-fast, fallback markdown tool calling. |
| `essentialai/rnj-1` | **Targeted retrieval, schema mapping** | Compact and efficient. |

---

## 3. Delegation Workflow (MCP Primary)

### Step 1: Health & Connectivity Check
Before delegating a critical workflow, inspect worker readiness:
```json
{
  "tool": "worker_health"
}
```
If `lm_studio_online` is `false`, either notify the user that LM Studio is stopped, or fall back to local direct execution.

### Step 2: Formulate the Instruction
Provide clear, self-contained instructions:
- Specify exact target directories or file paths.
- State explicit success criteria (e.g. "Create `src/utils.ts` with export X").
- Provide an `idempotency_key` (UUID or content hash) to ensure that retries or failover never re-run destructive operations twice.

### Step 3: Invoke `delegate_task`
**Synchronous (short tasks < 30s):**
```json
{
  "tool": "delegate_task",
  "arguments": {
    "instruction": "Scan ./src for all exported functions and generate a SUMMARY.md listing them.",
    "model": "qwen/qwen3-coder-30b",
    "mode": "sync",
    "idempotency_key": "task-summary-20261009",
    "context": {
      "targetDir": "./src"
    }
  }
}
```

**Asynchronous (long tasks, large builds):**
```json
{
  "tool": "delegate_task",
  "arguments": {
    "instruction": "Run test suite and generate coverage report in ./coverage",
    "mode": "async",
    "idempotency_key": "task-test-20261009"
  }
}
```
The server returns `{ "job_id": "job_12345", "status": "running" }`. Poll status with:
```json
{
  "tool": "get_job",
  "arguments": { "job_id": "job_12345" }
}
```

---

## 4. Redundant Transport Failover (WebSocket)

If the MCP stdio connection hangs, disconnects, or is running on a secondary machine across the LAN:

1. Connect to the WebSocket endpoint:
   `ws://127.0.0.1:3334?token=localtool-secret-token` (or LAN IP when `--lan` is enabled).
2. Send JSON-RPC 2.0 payload using the **identical `idempotency_key`**:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "delegate_task",
     "params": {
       "instruction": "Scan ./src for all exported functions...",
       "model": "qwen/qwen3-coder-30b",
       "mode": "sync",
       "idempotency_key": "task-summary-20261009"
     }
   }
   ```
3. Because both servers share the same SQLite store, the WebSocket server recognizes the job and returns the existing result or continues execution seamlessly.

---

## 5. Direct Deterministic Execution (`run_tool`)

When you do not need an LLM to reason, but simply need low-latency local execution of a specific tool:
```json
{
  "tool": "run_tool",
  "arguments": {
    "tool": "file_write",
    "args": {
      "path": "./config.local.json",
      "content": "{\"ready\": true}",
      "overwrite": true
    }
  }
}
```
Available tools:
- `file_list`: Directory scan with file size and modified timestamps.
- `file_read`: Text read with line range (`start_line`, `end_line`) and max bytes safeguard.
- `file_write`: Safe atomic write / append with automatic directory creation.
- `file_mkdir`: Recursive directory creation (`mkdir -p`).
- `file_delete`: Safe deletion with recursive options (blocks root deletion).
- `file_search`: Fast pattern matching for filenames or file contents.
- `shell_exec`: Sandboxed shell execution with timeout and output capture.

---

## 6. Output Verification Checklist

After receiving the delegation result:
1. **Check `status`**: Verify `status === "success"`. If `failed`, review `error` and decide whether to retry or handle locally.
2. **Review `tool_trace`**: Inspect the list of tools invoked by the local agent to confirm actions taken.
3. **Spot-check Artifacts**: Verify that generated or modified files exist and contain valid code.
