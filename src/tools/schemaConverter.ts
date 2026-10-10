import { z } from "zod";

/**
 * Lightweight Zod to JSON Schema converter for LocalTool
 * Supports z.object, z.string, z.number, z.boolean, z.array, optional, default, describe
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, any> {
  let current: any = schema;
  let isOptional = false;
  let defaultValue: any = undefined;
  let description: string | undefined = undefined;

  // Unwrap wrappers
  while (current) {
    if (current.description) {
      description = current.description;
    }
    const def = current._def;
    if (!def) break;

    const typeName = def.typeName;
    if (typeName === "ZodDefault") {
      defaultValue = typeof def.defaultValue === "function" ? def.defaultValue() : def.defaultValue;
      current = def.innerType;
    } else if (typeName === "ZodOptional" || typeName === "ZodNullable") {
      isOptional = true;
      current = def.innerType;
    } else if (typeName === "ZodEffects") {
      current = def.schema;
    } else {
      break;
    }
  }

  const def = current._def;
  const typeName = def?.typeName;

  let out: Record<string, any> = {};

  switch (typeName) {
    case "ZodString":
      out.type = "string";
      break;
    case "ZodNumber":
      out.type = "number";
      break;
    case "ZodBoolean":
      out.type = "boolean";
      break;
    case "ZodArray":
      out.type = "array";
      out.items = zodToJsonSchema(def.type);
      break;
    case "ZodObject": {
      out.type = "object";
      const shape = def.shape();
      out.properties = {};
      const required: string[] = [];

      for (const [key, propSchema] of Object.entries(shape)) {
        const propJson = zodToJsonSchema(propSchema as z.ZodTypeAny);
        out.properties[key] = propJson;

        // Check if required
        const propDef = (propSchema as any)._def;
        const isOpt = propDef?.typeName === "ZodOptional" || propDef?.typeName === "ZodDefault";
        if (!isOpt) {
          required.push(key);
        }
      }

      if (required.length > 0) {
        out.required = required;
      }
      break;
    }
    case "ZodEnum":
      out.type = "string";
      out.enum = def.values;
      break;
    default:
      out.type = "string";
  }

  if (description) {
    out.description = description;
  }
  if (defaultValue !== undefined) {
    out.default = defaultValue;
  }

  return out;
}
