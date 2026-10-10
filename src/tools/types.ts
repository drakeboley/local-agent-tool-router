import { z } from "zod";

export type PermissionTier = "read" | "write" | "exec";

export interface ToolContext {
  allowedRoots: string[];
  shellEnabled: boolean;
  execTimeoutMs: number;
  transport: string;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface LocalToolDefinition<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  parameters: TParams;
  permissionTier: PermissionTier;
  execute: (args: z.infer<TParams>, context: ToolContext) => Promise<ToolResult>;
}
