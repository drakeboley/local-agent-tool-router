import { LocalToolConfig } from "../config/index.js";
import { JobStore } from "../db/store.js";
import { ToolRegistry } from "../tools/registry.js";
import { LMStudioClient } from "../lmstudio/client.js";
import { WorkerAgent } from "../lmstudio/worker.js";
export declare class LocalToolWsServer {
    private config;
    private store;
    private registry;
    private client;
    private worker;
    private httpServer?;
    private wss?;
    private subscriptions;
    constructor(config: LocalToolConfig, store: JobStore, registry: ToolRegistry, client: LMStudioClient, worker: WorkerAgent);
    start(): Promise<void>;
    broadcastEvent(jobId: string, event: any): void;
    private handleJsonRpc;
    stop(): Promise<void>;
}
