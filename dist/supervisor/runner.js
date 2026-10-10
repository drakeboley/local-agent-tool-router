import { JobStore } from "../db/store.js";
import { ToolRegistry } from "../tools/registry.js";
import { LMStudioClient } from "../lmstudio/client.js";
import { WorkerAgent } from "../lmstudio/worker.js";
import { LocalToolMcpServer } from "../mcp/server.js";
import { LocalToolWsServer } from "../ws/server.js";
export class Supervisor {
    config;
    store;
    registry;
    client;
    worker;
    mcpServer;
    wsServer;
    healthInterval;
    constructor(config) {
        this.config = config;
        this.store = new JobStore(config.dbPath);
        this.registry = new ToolRegistry(this.store);
        this.client = new LMStudioClient(config.lmStudioUrl);
        this.worker = new WorkerAgent(this.client, this.registry, this.store);
    }
    async start(options = { enableMcpStdio: true, enableWs: true }) {
        console.error(`[LocalTool Bridge] Starting supervisor...`);
        console.error(`[LocalTool Bridge] Configured LM Studio URL: ${this.config.lmStudioUrl}`);
        console.error(`[LocalTool Bridge] Configured Default Model: ${this.config.defaultModel}`);
        console.error(`[LocalTool Bridge] Allowed Workspaces: ${this.config.allowedRoots.join(", ")}`);
        // Initial LM Studio check
        const health = await this.client.checkHealth();
        if (health.online) {
            console.error(`[LocalTool Bridge] LM Studio connected. Available models (${health.models.length}):`);
            for (const m of health.models.slice(0, 5)) {
                console.error(`  - ${m}`);
            }
        }
        else {
            console.error(`[LocalTool Bridge] Warning: LM Studio is currently unreachable at ${this.config.lmStudioUrl}.`);
            console.error(`[LocalTool Bridge] Tasks will report LM Studio offline until it is started.`);
        }
        // Start WebSocket server
        if (options.enableWs !== false) {
            this.wsServer = new LocalToolWsServer(this.config, this.store, this.registry, this.client, this.worker);
            await this.wsServer.start();
        }
        // Start MCP Server (stdio)
        if (options.enableMcpStdio) {
            this.mcpServer = new LocalToolMcpServer(this.config, this.store, this.registry, this.client, this.worker);
            await this.mcpServer.startStdio();
        }
        // Health check loop every 30s
        this.healthInterval = setInterval(async () => {
            try {
                const h = await this.client.checkHealth();
                if (!h.online) {
                    // Log only if offline
                    console.error(`[LocalTool Supervisor] Health alert: LM Studio offline (${h.error})`);
                }
            }
            catch {
                // silent
            }
        }, 30000);
        // Setup process exit listeners
        const shutdown = async () => {
            console.error("\n[LocalTool Supervisor] Shutting down gracefully...");
            if (this.healthInterval)
                clearInterval(this.healthInterval);
            if (this.wsServer)
                await this.wsServer.stop();
            this.store.close();
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
    }
    getStore() {
        return this.store;
    }
    getRegistry() {
        return this.registry;
    }
    getClient() {
        return this.client;
    }
}
//# sourceMappingURL=runner.js.map