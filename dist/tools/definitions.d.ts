import { LocalToolDefinition } from "./types.js";
/**
 * Validates and resolves a target path to ensure it stays within allowed roots.
 */
export declare function resolveSafePath(targetPath: string, allowedRoots: string[]): string;
export declare const fileListTool: LocalToolDefinition;
export declare const fileReadTool: LocalToolDefinition;
export declare const fileWriteTool: LocalToolDefinition;
export declare const fileMkdirTool: LocalToolDefinition;
export declare const fileDeleteTool: LocalToolDefinition;
export declare const fileSearchTool: LocalToolDefinition;
export declare const shellExecTool: LocalToolDefinition;
export declare const ALL_TOOLS: LocalToolDefinition[];
