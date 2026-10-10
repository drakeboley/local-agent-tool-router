import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { LocalToolConfig } from "../config/index.js";
import { JobStore } from "../db/store.js";
import { ToolRegistry } from "../tools/registry.js";
import { LMStudioClient } from "../lmstudio/client.js";
import { WorkerAgent } from "../lmstudio/worker.js";

export class LocalToolMcpServer {
  private server: Server;
  private config: LocalToolConfig;
  private store: JobStore;
  private registry: ToolRegistry;
  private client: LMStudioClient;
  private worker: WorkerAgent;

  constructor(
    config: LocalToolConfig,
    store: JobStore,
    registry: ToolRegistry,
    client: LMStudioClient,
    worker: WorkerAgent
  ) {
    this.config = config;
    this.store = store;
    this.registry = registry;
    this.client = client;
    this.worker = worker;

    this.server = new Server(
      {
        name: "localtool-bridge",
        version: "1.0.0"
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        }
      }
    );

    this.registerHandlers();
  }

  private registerHandlers(): void {
    // 1. List available tools to the caller agent
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const localTools = this.registry.toMcpTools();

      return {
        tools: [
          {
            name: "delegate_task",
            description:
              "Delegate a local task to the local LM Studio worker agent. The worker autonomously analyzes the request and executes local tools (file manipulation, shell commands, etc.) step-by-step.",
            inputSchema: {
              type: "object",
              properties: {
                instruction: {
                  type: "string",
                  description: "Detailed instruction for the local worker agent."
                },
                context: {
                  type: "object",
                  description: "Optional context or metadata dictionary to provide to the worker."
                },
                model: {
                  type: "string",
                  description: `Model to use (default: ${this.config.defaultModel}). Options: ${this.config.models.join(", ")}`
                },
                mode: {
                  type: "string",
                  enum: ["sync", "async"],
                  description: "Execution mode: 'sync' (waits for completion) or 'async' (returns job_id immediately)."
                },
                idempotency_key: {
                  type: "string",
                  description: "Unique key to prevent duplicate execution across retries or failover."
                },
                max_steps: {
                  type: "number",
                  description: "Maximum autonomous steps (default: 10)."
                }
              },
              required: ["instruction"]
            }
          },
          {
            name: "run_tool",
            description:
              "Directly execute a local tool without an LLM in the loop (deterministic, low latency). Available tools: file_list, file_read, file_write, file_mkdir, file_delete, file_search, shell_exec.",
            inputSchema: {
              type: "object",
              properties: {
                tool: {
                  type: "string",
                  description: "Name of the local tool to execute"
                },
                args: {
                  type: "object",
                  description: "Parameters object for the selected tool"
                }
              },
              required: ["tool"]
            }
          },
          {
            name: "get_job",
            description: "Check the status, tool trace, and result of an async or completed delegated job.",
            inputSchema: {
              type: "object",
              properties: {
                job_id: {
                  type: "string",
                  description: "The ID of the job to inspect"
                }
              },
              required: ["job_id"]
            }
          },
          {
            name: "cancel_job",
            description: "Cancel a currently running background delegated job.",
            inputSchema: {
              type: "object",
              properties: {
                job_id: {
                  type: "string",
                  description: "The ID of the job to cancel"
                }
              },
              required: ["job_id"]
            }
          },
          {
            name: "list_jobs",
            description: "List recent delegated jobs and their status.",
            inputSchema: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description: "Maximum jobs to return (default: 10)"
                },
                status: {
                  type: "string",
                  enum: ["pending", "running", "completed", "failed", "cancelled"],
                  description: "Filter by status"
                }
              }
            }
          },
          {
            name: "list_local_tools",
            description: "List all low-level local tools registered on this bridge and their schemas.",
            inputSchema: {
              type: "object",
              properties: {}
            }
          },
          {
            name: "worker_health",
            description: "Check connectivity to LM Studio, active models, and bridge status.",
            inputSchema: {
              type: "object",
              properties: {}
            }
          }
        ]
      };
    });

    // 2. Call tool execution handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const toolCtx = {
        allowedRoots: this.config.allowedRoots,
        shellEnabled: this.config.shellEnabled,
        execTimeoutMs: this.config.execTimeoutMs,
        transport: "mcp"
      };

      switch (name) {
        case "delegate_task": {
          const instruction = String(args?.instruction || "");
          const context = (args?.context as Record<string, any>) || undefined;
          const model = String(args?.model || this.config.defaultModel);
          const mode = (args?.mode as "sync" | "async") || "sync";
          const idempotency_key = args?.idempotency_key ? String(args.idempotency_key) : undefined;
          const maxSteps = typeof args?.max_steps === "number" ? args.max_steps : this.config.maxWorkerSteps;

          const { job, isExisting } = this.store.createJob({
            instruction,
            mode,
            model,
            transport: "mcp",
            idempotency_key
          });

          if (isExisting && job.status === "completed") {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      job_id: job.id,
                      status: job.status,
                      cached: true,
                      result: job.result ? JSON.parse(job.result) : null
                    },
                    null,
                    2
                  )
                }
              ]
            };
          }

          // If async, start execution in background and return job_id immediately
          if (mode === "async") {
            this.store.updateJobStatus(job.id, "running");
            // Run detached
            (async () => {
              try {
                const res = await this.worker.executeTask({
                  jobId: job.id,
                  instruction,
                  model,
                  context,
                  toolContext: toolCtx,
                  maxSteps
                });
                this.store.updateJobStatus(
                  job.id,
                  res.status === "success" ? "completed" : "failed",
                  res,
                  res.error
                );
              } catch (err: any) {
                this.store.updateJobStatus(job.id, "failed", null, err.message);
              }
            })();

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      job_id: job.id,
                      status: "running",
                      message: "Task is executing in background. Use get_job to poll result."
                    },
                    null,
                    2
                  )
                }
              ]
            };
          }

          // Sync mode: await completion
          this.store.updateJobStatus(job.id, "running");
          try {
            const res = await this.worker.executeTask({
              jobId: job.id,
              instruction,
              model,
              context,
              toolContext: toolCtx,
              maxSteps
            });

            this.store.updateJobStatus(
              job.id,
              res.status === "success" ? "completed" : "failed",
              res,
              res.error
            );

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      job_id: job.id,
                      status: res.status,
                      summary: res.summary,
                      tool_trace: res.tool_trace,
                      steps: res.steps,
                      duration_ms: this.store.getJob(job.id)?.duration_ms
                    },
                    null,
                    2
                  )
                }
              ]
            };
          } catch (err: any) {
            this.store.updateJobStatus(job.id, "failed", null, err.message);
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ job_id: job.id, status: "failed", error: err.message }, null, 2)
                }
              ]
            };
          }
        }

        case "run_tool": {
          const toolName = String(args?.tool || "");
          const toolArgs = args?.args || {};

          const result = await this.registry.execute(toolName, toolArgs, toolCtx);
          return {
            isError: !result.success,
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2)
              }
            ]
          };
        }

        case "get_job": {
          const jobId = String(args?.job_id || "");
          const job = this.store.getJob(jobId);
          if (!job) {
            return {
              isError: true,
              content: [{ type: "text", text: `Job not found: ${jobId}` }]
            };
          }
          const events = this.store.getJobEvents(jobId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ...job,
                    result: job.result ? JSON.parse(job.result) : null,
                    events
                  },
                  null,
                  2
                )
              }
            ]
          };
        }

        case "cancel_job": {
          const jobId = String(args?.job_id || "");
          const success = this.store.cancelJob(jobId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ job_id: jobId, cancelled: success })
              }
            ]
          };
        }

        case "list_jobs": {
          const limit = typeof args?.limit === "number" ? args.limit : 10;
          const status = args?.status as any;
          const jobs = this.store.listJobs(limit, status);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  jobs.map((j) => ({
                    ...j,
                    result: j.result ? JSON.parse(j.result) : null
                  })),
                  null,
                  2
                )
              }
            ]
          };
        }

        case "list_local_tools": {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(this.registry.toMcpTools(), null, 2)
              }
            ]
          };
        }

        case "worker_health": {
          const health = await this.client.checkHealth();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    lm_studio_online: health.online,
                    lm_studio_url: this.client.getBaseUrl(),
                    available_models: health.models,
                    configured_default_model: this.config.defaultModel,
                    allowed_workspaces: this.config.allowedRoots,
                    shell_enabled: this.config.shellEnabled,
                    error: health.error
                  },
                  null,
                  2
                )
              }
            ]
          };
        }

        default:
          return {
            isError: true,
            content: [{ type: "text", text: `Unknown tool: ${name}` }]
          };
      }
    });

    // 3. Resources handlers
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: "localtool://audit",
            name: "Recent Audit Log",
            mimeType: "application/json",
            description: "Audit log of all local tool executions"
          }
        ]
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      if (uri === "localtool://audit") {
        const logs = this.store.getRecentAuditLogs(50);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(logs, null, 2)
            }
          ]
        };
      }
      throw new Error(`Resource not found: ${uri}`);
    });
  }

  /**
   * Start server over Stdio transport
   */
  public async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[LocalTool MCP] Connected over stdio");
  }

  public getServer(): Server {
    return this.server;
  }
}
