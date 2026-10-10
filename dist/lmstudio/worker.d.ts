import { LMStudioClient } from "./client.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolContext } from "../tools/types.js";
import { JobStore } from "../db/store.js";
export interface WorkerProgressEvent {
    jobId: string;
    step: number;
    type: "thinking" | "tool_call" | "tool_result" | "message";
    toolName?: string;
    toolArgs?: any;
    result?: any;
    message?: string;
}
export interface WorkerExecutionResult {
    status: "success" | "error" | "cancelled";
    summary: string;
    tool_trace: Array<{
        step: number;
        tool: string;
        args: any;
        result: any;
        duration_ms: number;
    }>;
    steps: number;
    total_tokens?: number;
    error?: string;
}
export declare class WorkerAgent {
    private client;
    private registry;
    private store?;
    constructor(client: LMStudioClient, registry: ToolRegistry, store?: JobStore);
    /**
     * Helper to parse JSON or <tool_call> syntax from message text for models
     * that do not natively emit OpenAI function calls.
     */
    private extractFallbackToolCalls;
    executeTask(params: {
        jobId: string;
        instruction: string;
        model: string;
        context?: Record<string, any>;
        toolContext: ToolContext;
        maxSteps?: number;
        onProgress?: (event: WorkerProgressEvent) => void;
    }): Promise<WorkerExecutionResult>;
}
