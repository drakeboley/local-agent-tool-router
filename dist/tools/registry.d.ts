import { LocalToolDefinition, ToolContext, ToolResult } from "./types.js";
import { JobStore } from "../db/store.js";
export declare class ToolRegistry {
    private tools;
    private store?;
    constructor(store?: JobStore);
    register(tool: LocalToolDefinition): void;
    get(name: string): LocalToolDefinition | undefined;
    list(): LocalToolDefinition[];
    /**
     * Returns tools formatted as OpenAI function definitions for LM Studio
     */
    toOpenAIFunctions(): any[];
    /**
     * Returns tools formatted for Model Context Protocol (MCP)
     */
    toMcpTools(): any[];
    /**
     * Executes a tool with input validation, policy checks, and audit logging
     */
    execute(name: string, args: any, context: ToolContext): Promise<ToolResult>;
}
