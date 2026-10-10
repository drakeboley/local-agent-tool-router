import { zodToJsonSchema } from "./schemaConverter.js";
import { ALL_TOOLS } from "./definitions.js";
import { LocalToolDefinition, ToolContext, ToolResult } from "./types.js";
import { JobStore } from "../db/store.js";

export class ToolRegistry {
  private tools: Map<string, LocalToolDefinition> = new Map();
  private store?: JobStore;

  constructor(store?: JobStore) {
    this.store = store;
    for (const tool of ALL_TOOLS) {
      this.register(tool);
    }
  }

  public register(tool: LocalToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): LocalToolDefinition | undefined {
    return this.tools.get(name);
  }

  public list(): LocalToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns tools formatted as OpenAI function definitions for LM Studio
   */
  public toOpenAIFunctions(): any[] {
    return this.list().map((tool) => {
      const jsonSchema = (zodToJsonSchema as any)(tool.parameters, {
        target: "openApi3",
        $refStrategy: "none"
      });

      // Strip top-level definitions or $schema if present
      delete jsonSchema.$schema;
      delete jsonSchema.definitions;

      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: jsonSchema
        }
      };
    });
  }

  /**
   * Returns tools formatted for Model Context Protocol (MCP)
   */
  public toMcpTools(): any[] {
    return this.list().map((tool) => {
      const jsonSchema = (zodToJsonSchema as any)(tool.parameters, {
        target: "jsonSchema7",
        $refStrategy: "none"
      });
      delete jsonSchema.$schema;
      delete jsonSchema.definitions;

      return {
        name: tool.name,
        description: tool.description,
        inputSchema: jsonSchema
      };
    });
  }

  /**
   * Executes a tool with input validation, policy checks, and audit logging
   */
  public async execute(
    name: string,
    args: any,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      const err = `Tool not found: ${name}. Available: ${Array.from(this.tools.keys()).join(", ")}`;
      return { success: false, error: err };
    }

    const startTime = Date.now();
    let result: ToolResult;

    try {
      // Validate arguments with Zod
      const parsedArgs = tool.parameters.parse(args || {});
      result = await tool.execute(parsedArgs, context);
    } catch (err: any) {
      result = {
        success: false,
        error: `Tool execution failed: ${err.message}`
      };
    }

    const duration = Date.now() - startTime;

    // Log to audit log if store is attached
    if (this.store) {
      this.store.logAudit({
        timestamp: startTime,
        transport: context.transport,
        tool_name: name,
        args,
        status: result.success ? "success" : "error",
        duration_ms: duration,
        error: result.error ?? null
      });
    }

    return result;
  }
}
