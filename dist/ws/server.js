import { WebSocketServer, WebSocket } from "ws";
import * as http from "node:http";
export class LocalToolWsServer {
    config;
    store;
    registry;
    client;
    worker;
    httpServer;
    wss;
    subscriptions = new Map(); // ws -> set of job_ids or "*"
    constructor(config, store, registry, client, worker) {
        this.config = config;
        this.store = store;
        this.registry = registry;
        this.client = client;
        this.worker = worker;
    }
    async start() {
        return new Promise((resolve, reject) => {
            this.httpServer = http.createServer((req, res) => {
                // Also provide a lightweight HTTP /health and /status endpoint
                const parsedUrl = new URL(req.url || "/", "http://localhost");
                if (parsedUrl.pathname === "/health") {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        status: "ok",
                        bridge: "localtool-bridge",
                        mode: this.config.listenLan ? "lan" : "local",
                        port: this.config.wsPort
                    }));
                    return;
                }
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end("LocalTool WebSocket server. Connect using ws:// or wss://\n");
            });
            this.wss = new WebSocketServer({ server: this.httpServer });
            this.wss.on("connection", (ws, req) => {
                // Verify token if configured
                const reqUrl = new URL(req.url || "/", "http://localhost");
                const token = reqUrl.searchParams.get("token") ||
                    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
                if (this.config.authToken && token !== this.config.authToken) {
                    // If token doesn't match and not running on localhost without auth
                    const remoteIp = req.socket.remoteAddress;
                    const isLocal = remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1";
                    // If on LAN, auth token is strictly mandatory!
                    if (!isLocal && token !== this.config.authToken) {
                        ws.close(4001, "Unauthorized: Invalid or missing bearer token");
                        return;
                    }
                }
                this.subscriptions.set(ws, new Set());
                // Heartbeat
                let isAlive = true;
                ws.on("pong", () => {
                    isAlive = true;
                });
                ws.on("message", async (data) => {
                    try {
                        const raw = data.toString("utf-8");
                        const request = JSON.parse(raw);
                        const response = await this.handleJsonRpc(request, ws);
                        if (response && request.id !== undefined) {
                            ws.send(JSON.stringify(response));
                        }
                    }
                    catch (err) {
                        ws.send(JSON.stringify({
                            jsonrpc: "2.0",
                            id: null,
                            error: { code: -32700, message: `Parse error: ${err.message}` }
                        }));
                    }
                });
                ws.on("close", () => {
                    this.subscriptions.delete(ws);
                });
            });
            this.httpServer.listen(this.config.wsPort, this.config.host, () => {
                console.error(`[LocalTool WS] Server listening on ws://${this.config.host}:${this.config.wsPort} (LAN: ${this.config.listenLan})`);
                resolve();
            });
            this.httpServer.on("error", (err) => {
                reject(err);
            });
        });
    }
    broadcastEvent(jobId, event) {
        const payload = JSON.stringify({
            jsonrpc: "2.0",
            method: "job.event",
            params: { jobId, event }
        });
        for (const [ws, subs] of this.subscriptions.entries()) {
            if (ws.readyState === WebSocket.OPEN) {
                if (subs.has("*") || subs.has(jobId)) {
                    ws.send(payload);
                }
            }
        }
    }
    async handleJsonRpc(req, ws) {
        const toolCtx = {
            allowedRoots: this.config.allowedRoots,
            shellEnabled: this.config.shellEnabled,
            execTimeoutMs: this.config.execTimeoutMs,
            transport: "ws"
        };
        const method = req.method;
        const params = req.params || {};
        try {
            switch (method) {
                case "health": {
                    const health = await this.client.checkHealth();
                    return {
                        jsonrpc: "2.0",
                        id: req.id,
                        result: {
                            status: "ok",
                            host: this.config.host,
                            port: this.config.wsPort,
                            lan_mode: this.config.listenLan,
                            lm_studio_online: health.online,
                            available_models: health.models,
                            default_model: this.config.defaultModel,
                            error: health.error
                        }
                    };
                }
                case "subscribe": {
                    const jobId = params.job_id || "*";
                    const clientSubs = this.subscriptions.get(ws);
                    if (clientSubs) {
                        clientSubs.add(jobId);
                    }
                    return {
                        jsonrpc: "2.0",
                        id: req.id,
                        result: { subscribed: true, target: jobId }
                    };
                }
                case "delegate_task": {
                    const instruction = String(params.instruction || "");
                    const context = params.context;
                    const model = String(params.model || this.config.defaultModel);
                    const mode = params.mode || "sync";
                    const idempotency_key = params.idempotency_key;
                    const maxSteps = typeof params.max_steps === "number" ? params.max_steps : this.config.maxWorkerSteps;
                    const { job, isExisting } = this.store.createJob({
                        instruction,
                        mode,
                        model,
                        transport: "ws",
                        idempotency_key
                    });
                    if (isExisting && job.status === "completed") {
                        return {
                            jsonrpc: "2.0",
                            id: req.id,
                            result: {
                                job_id: job.id,
                                status: job.status,
                                cached: true,
                                result: job.result ? JSON.parse(job.result) : null
                            }
                        };
                    }
                    // Auto-subscribe connection to this job's events
                    this.subscriptions.get(ws)?.add(job.id);
                    const onProgress = (evt) => {
                        this.broadcastEvent(job.id, evt);
                    };
                    if (mode === "async") {
                        this.store.updateJobStatus(job.id, "running");
                        (async () => {
                            try {
                                const res = await this.worker.executeTask({
                                    jobId: job.id,
                                    instruction,
                                    model,
                                    context,
                                    toolContext: toolCtx,
                                    maxSteps,
                                    onProgress
                                });
                                this.store.updateJobStatus(job.id, res.status === "success" ? "completed" : "failed", res, res.error);
                                this.broadcastEvent(job.id, { type: "done", status: res.status });
                            }
                            catch (err) {
                                this.store.updateJobStatus(job.id, "failed", null, err.message);
                                this.broadcastEvent(job.id, { type: "error", error: err.message });
                            }
                        })();
                        return {
                            jsonrpc: "2.0",
                            id: req.id,
                            result: { job_id: job.id, status: "running", mode: "async" }
                        };
                    }
                    // Sync execution
                    this.store.updateJobStatus(job.id, "running");
                    const res = await this.worker.executeTask({
                        jobId: job.id,
                        instruction,
                        model,
                        context,
                        toolContext: toolCtx,
                        maxSteps,
                        onProgress
                    });
                    this.store.updateJobStatus(job.id, res.status === "success" ? "completed" : "failed", res, res.error);
                    return {
                        jsonrpc: "2.0",
                        id: req.id,
                        result: {
                            job_id: job.id,
                            status: res.status,
                            summary: res.summary,
                            tool_trace: res.tool_trace,
                            steps: res.steps,
                            duration_ms: this.store.getJob(job.id)?.duration_ms
                        }
                    };
                }
                case "run_tool": {
                    const toolName = String(params.tool || "");
                    const toolArgs = params.args || {};
                    const result = await this.registry.execute(toolName, toolArgs, toolCtx);
                    return {
                        jsonrpc: "2.0",
                        id: req.id,
                        result
                    };
                }
                case "get_job": {
                    const jobId = String(params.job_id || "");
                    const job = this.store.getJob(jobId);
                    if (!job) {
                        return {
                            jsonrpc: "2.0",
                            id: req.id,
                            error: { code: -32602, message: `Job not found: ${jobId}` }
                        };
                    }
                    const events = this.store.getJobEvents(jobId);
                    return {
                        jsonrpc: "2.0",
                        id: req.id,
                        result: {
                            ...job,
                            result: job.result ? JSON.parse(job.result) : null,
                            events
                        }
                    };
                }
                case "cancel_job": {
                    const jobId = String(params.job_id || "");
                    const success = this.store.cancelJob(jobId);
                    return {
                        jsonrpc: "2.0",
                        id: req.id,
                        result: { job_id: jobId, cancelled: success }
                    };
                }
                case "list_jobs": {
                    const limit = typeof params.limit === "number" ? params.limit : 10;
                    const status = params.status;
                    const jobs = this.store.listJobs(limit, status);
                    return {
                        jsonrpc: "2.0",
                        id: req.id,
                        result: jobs.map((j) => ({
                            ...j,
                            result: j.result ? JSON.parse(j.result) : null
                        }))
                    };
                }
                case "list_tools": {
                    return {
                        jsonrpc: "2.0",
                        id: req.id,
                        result: this.registry.toMcpTools()
                    };
                }
                default:
                    return {
                        jsonrpc: "2.0",
                        id: req.id,
                        error: { code: -32601, message: `Method not found: ${method}` }
                    };
            }
        }
        catch (err) {
            return {
                jsonrpc: "2.0",
                id: req.id,
                error: { code: -32000, message: err.message }
            };
        }
    }
    async stop() {
        if (this.wss) {
            this.wss.close();
        }
        if (this.httpServer) {
            this.httpServer.close();
        }
    }
}
//# sourceMappingURL=server.js.map