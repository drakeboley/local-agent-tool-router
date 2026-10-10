import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { LocalToolConfig } from "../config/index.js";
import { JobStore } from "../db/store.js";
import { ToolRegistry } from "../tools/registry.js";
import { LMStudioClient } from "../lmstudio/client.js";
import { WorkerAgent } from "../lmstudio/worker.js";
export declare class LocalToolMcpServer {
    private server;
    private config;
    private store;
    private registry;
    private client;
    private worker;
    constructor(config: LocalToolConfig, store: JobStore, registry: ToolRegistry, client: LMStudioClient, worker: WorkerAgent);
    private registerHandlers;
    /**
     * Start server over Stdio transport
     */
    startStdio(): Promise<void>;
    getServer(): Server;
}
