import { LocalToolConfig } from "../config/index.js";
import { JobStore } from "../db/store.js";
import { ToolRegistry } from "../tools/registry.js";
import { LMStudioClient } from "../lmstudio/client.js";
export interface SupervisorOptions {
    enableMcpStdio?: boolean;
    enableWs?: boolean;
}
export declare class Supervisor {
    private config;
    private store;
    private registry;
    private client;
    private worker;
    private mcpServer?;
    private wsServer?;
    private healthInterval?;
    constructor(config: LocalToolConfig);
    start(options?: SupervisorOptions): Promise<void>;
    getStore(): JobStore;
    getRegistry(): ToolRegistry;
    getClient(): LMStudioClient;
}
