import { z } from "zod";
/**
 * Lightweight Zod to JSON Schema converter for LocalTool
 * Supports z.object, z.string, z.number, z.boolean, z.array, optional, default, describe
 */
export declare function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, any>;
