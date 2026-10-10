import { test, describe, before, after } from "node:test";
import * as assert from "node:assert";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { WebSocket } from "ws";

import { JobStore } from "../dist/db/store.js";
import { ToolRegistry } from "../dist/tools/registry.js";
import { resolveSafePath } from "../dist/tools/definitions.js";
import { LMStudioClient } from "../dist/lmstudio/client.js";
import { WorkerAgent } from "../dist/lmstudio/worker.js";
import { LocalToolWsServer } from "../dist/ws/server.js";
import { loadConfig } from "../dist/config/index.js";

describe("LocalTool Bridge Test Suite", () => {
  const testDir = path.resolve("./test_workspace");
  const testDb = path.resolve("./test_workspace/test.db");

  before(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("JobStore & SQLite Persistence", () => {
    test("creates job and enforces idempotency", () => {
      const store = new JobStore(testDb);
      const { job: job1, isExisting: isExisting1 } = store.createJob({
        instruction: "Task 1",
        model: "qwen/qwen3-coder-30b",
        transport: "mcp",
        idempotency_key: "idem-key-1"
      });

      assert.strictEqual(isExisting1, false);
      assert.strictEqual(job1.instruction, "Task 1");
      assert.strictEqual(job1.status, "pending");

      // Second call with same idempotency key
      const { job: job2, isExisting: isExisting2 } = store.createJob({
        instruction: "Task 1 duplicate",
        model: "qwen/qwen3-coder-30b",
        transport: "mcp",
        idempotency_key: "idem-key-1"
      });

      assert.strictEqual(isExisting2, true);
      assert.strictEqual(job2.id, job1.id);

      // Update status
      store.updateJobStatus(job1.id, "completed", { answer: 42 });
      const updated = store.getJob(job1.id);
      assert.strictEqual(updated?.status, "completed");
      assert.deepStrictEqual(JSON.parse(updated!.result!), { answer: 42 });

      store.close();
    });

    test("appends events and logs audit", () => {
      const store = new JobStore(testDb);
      store.appendJobEvent("job_xyz", "step", { step: 1, action: "testing" });
      const events = store.getJobEvents("job_xyz");
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].payload.step, 1);

      store.logAudit({
        timestamp: Date.now(),
        transport: "ws",
        tool_name: "file_write",
        args: { path: "test.txt" },
        status: "success",
        duration_ms: 12,
        error: null
      });

      const audit = store.getRecentAuditLogs(5);
      assert.strictEqual(audit.length >= 1, true);
      assert.strictEqual(audit[0].tool_name, "file_write");
      store.close();
    });
  });

  describe("Local Tool Registry & Security Policies", () => {
    const store = new JobStore(":memory:");
    const registry = new ToolRegistry(store);
    const ctx = {
      allowedRoots: [testDir],
      shellEnabled: true,
      execTimeoutMs: 5000,
      transport: "test"
    };

    test("blocks path traversal outside allowedRoots", async () => {
      assert.throws(() => {
        resolveSafePath("/etc/shadow", [testDir]);
      }, /Access Denied/);

      assert.throws(() => {
        resolveSafePath("../../outside.txt", [testDir]);
      }, /Access Denied/);
    });

    test("executes file_write, file_read, and file_list", async () => {
      // 1. Write file
      const filePath = path.join(testDir, "hello.txt");
      const writeRes = await registry.execute(
        "file_write",
        { path: filePath, content: "Line 1\nLine 2\nLine 3", overwrite: true },
        ctx
      );
      assert.strictEqual(writeRes.success, true);
      assert.strictEqual(fs.existsSync(filePath), true);

      // 2. Read file
      const readRes = await registry.execute(
        "file_read",
        { path: filePath, start_line: 2, end_line: 2 },
        ctx
      );
      assert.strictEqual(readRes.success, true);
      assert.strictEqual(readRes.data.content, "Line 2");

      // 3. List directory
      const listRes = await registry.execute("file_list", { directory: testDir }, ctx);
      assert.strictEqual(listRes.success, true);
      assert.strictEqual(listRes.data.total_items >= 1, true);
    });

    test("executes shell_exec inside allowed directory", async () => {
      const res = await registry.execute(
        "shell_exec",
        { command: "echo 'hello from shell'", cwd: testDir },
        ctx
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.stdout, "hello from shell");
    });
  });

  describe("Worker Agent Loop with Mock LM Studio", () => {
    let mockServer: http.Server;
    const mockPort = 12349;
    let callCount = 0;

    before((done) => {
      mockServer = http.createServer((req, res) => {
        if (req.url === "/v1/models") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              data: [{ id: "qwen/qwen3-coder-30b", object: "model" }]
            })
          );
          return;
        }

        if (req.url === "/v1/chat/completions" && req.method === "POST") {
          callCount++;
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            res.writeHead(200, { "Content-Type": "application/json" });

            if (callCount === 1) {
              // Return tool call to create a file
              res.end(
                JSON.stringify({
                  id: "comp_1",
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: "assistant",
                        tool_calls: [
                          {
                            id: "call_abc",
                            type: "function",
                            function: {
                              name: "file_write",
                              arguments: JSON.stringify({
                                path: path.join(testDir, "agent_output.txt"),
                                content: "Created by worker agent autonomously"
                              })
                            }
                          }
                        ]
                      },
                      finish_reason: "tool_calls"
                    }
                  ],
                  usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
                })
              );
            } else {
              // Step 2: Final answer
              res.end(
                JSON.stringify({
                  id: "comp_2",
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: "assistant",
                        content: "Task completed successfully. Created agent_output.txt."
                      },
                      finish_reason: "stop"
                    }
                  ],
                  usage: { prompt_tokens: 80, completion_tokens: 15, total_tokens: 95 }
                })
              );
            }
          });
          return;
        }

        res.writeHead(404);
        res.end();
      });

      mockServer.listen(mockPort, done);
    });

    after((done) => {
      mockServer.close(done);
    });

    test("worker plans, calls local tool, and concludes", async () => {
      const store = new JobStore(":memory:");
      const registry = new ToolRegistry(store);
      const client = new LMStudioClient(`http://127.0.0.1:${mockPort}`);
      const worker = new WorkerAgent(client, registry, store);

      const ctx = {
        allowedRoots: [testDir],
        shellEnabled: true,
        execTimeoutMs: 5000,
        transport: "test"
      };

      const result = await worker.executeTask({
        jobId: "test_job_1",
        instruction: "Create agent_output.txt with content",
        model: "qwen/qwen3-coder-30b",
        toolContext: ctx
      });

      assert.strictEqual(result.status, "success");
      assert.strictEqual(result.steps, 2);
      assert.strictEqual(result.tool_trace.length, 1);
      assert.strictEqual(result.tool_trace[0].tool, "file_write");
      assert.strictEqual(fs.existsSync(path.join(testDir, "agent_output.txt")), true);
      assert.match(result.summary, /agent_output\.txt/);
    });

    test("worker supports markdown JSON tool calling fallback for small models", async () => {
      let localCalls = 0;
      const smallModelServer = http.createServer((req, res) => {
        localCalls++;
        res.writeHead(200, { "Content-Type": "application/json" });
        if (localCalls === 1) {
          // Model outputs markdown JSON block instead of native OpenAI function call
          res.end(
            JSON.stringify({
              id: "comp_small_1",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "I will write the file:\n```json\n{\"tool\": \"file_write\", \"args\": {\"path\": \"" + path.join(testDir, "small_model.txt") + "\", \"content\": \"written by small model\"}}\n```"
                  },
                  finish_reason: "stop"
                }
              ]
            })
          );
        } else {
          res.end(
            JSON.stringify({
              id: "comp_small_2",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "File has been created."
                  },
                  finish_reason: "stop"
                }
              ]
            })
          );
        }
      });

      await new Promise<void>((r) => smallModelServer.listen(12350, r));

      const store = new JobStore(":memory:");
      const registry = new ToolRegistry(store);
      const client = new LMStudioClient("http://127.0.0.1:12350");
      const worker = new WorkerAgent(client, registry, store);

      const ctx = {
        allowedRoots: [testDir],
        shellEnabled: true,
        execTimeoutMs: 5000,
        transport: "test"
      };

      const result = await worker.executeTask({
        jobId: "test_job_small",
        instruction: "Write small_model.txt",
        model: "liquid/lfm2.5-1.2b",
        toolContext: ctx
      });

      assert.strictEqual(result.status, "success");
      assert.strictEqual(result.tool_trace.length, 1);
      assert.strictEqual(result.tool_trace[0].tool, "file_write");
      assert.strictEqual(fs.existsSync(path.join(testDir, "small_model.txt")), true);

      await new Promise<void>((r) => smallModelServer.close(() => r()));
    });
  });

  describe("WebSocket Server JSON-RPC Protocol", () => {
    let wsServer: LocalToolWsServer;
    const wsPort = 13334;
    const token = "secret-test-token";

    before(async () => {
      const store = new JobStore(":memory:");
      const registry = new ToolRegistry(store);
      const client = new LMStudioClient("http://127.0.0.1:9999"); // offline dummy
      const worker = new WorkerAgent(client, registry, store);

      const config = loadConfig({
        wsPort,
        authToken: token,
        allowedRoots: [testDir]
      });

      wsServer = new LocalToolWsServer(config, store, registry, client, worker);
      await wsServer.start();
    });

    after(async () => {
      await wsServer.stop();
    });

    test("handles run_tool and list_tools over WebSocket", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${token}`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
      });

      // 1. Test list_tools
      const listReq = {
        jsonrpc: "2.0",
        id: 1,
        method: "list_tools"
      };

      const listResponse = await new Promise<any>((resolve) => {
        ws.once("message", (data) => resolve(JSON.parse(data.toString())));
        ws.send(JSON.stringify(listReq));
      });

      assert.strictEqual(listResponse.id, 1);
      assert.strictEqual(Array.isArray(listResponse.result), true);
      const toolNames = listResponse.result.map((t: any) => t.name);
      assert.strictEqual(toolNames.includes("file_write"), true);
      assert.strictEqual(toolNames.includes("shell_exec"), true);

      // 2. Test run_tool (file_write)
      const runReq = {
        jsonrpc: "2.0",
        id: 2,
        method: "run_tool",
        params: {
          tool: "file_write",
          args: {
            path: path.join(testDir, "ws_test.txt"),
            content: "Written via WebSocket JSON-RPC"
          }
        }
      };

      const runResponse = await new Promise<any>((resolve) => {
        ws.once("message", (data) => resolve(JSON.parse(data.toString())));
        ws.send(JSON.stringify(runReq));
      });

      assert.strictEqual(runResponse.id, 2);
      assert.strictEqual(runResponse.result.success, true);
      assert.strictEqual(fs.existsSync(path.join(testDir, "ws_test.txt")), true);

      ws.close();
    });
  });
});
