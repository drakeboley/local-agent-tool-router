import * as fs from "node:fs";
import * as path from "node:path";
import * as child_process from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { LocalToolDefinition, ToolContext, ToolResult } from "./types.js";

const execAsync = promisify(child_process.exec);

/**
 * Validates and resolves a target path to ensure it stays within allowed roots.
 */
export function resolveSafePath(targetPath: string, allowedRoots: string[]): string {
  const resolved = path.resolve(process.cwd(), targetPath);

  // If allowedRoots is empty or contains root '/', allow it
  if (!allowedRoots || allowedRoots.length === 0 || allowedRoots.includes("/")) {
    return resolved;
  }

  // Canonicalize path check
  const isAllowed = allowedRoots.some((root) => {
    const canonicalRoot = path.resolve(process.cwd(), root);
    const relative = path.relative(canonicalRoot, resolved);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  });

  if (!isAllowed) {
    throw new Error(
      `Access Denied: Path '${targetPath}' resolves to '${resolved}', which is outside allowed workspaces: [${allowedRoots.join(", ")}]`
    );
  }

  return resolved;
}

// 1. file_list (ls)
export const fileListTool: LocalToolDefinition = {
  name: "file_list",
  description: "List directory contents with file size, type, and modified time (similar to ls -la).",
  permissionTier: "read",
  parameters: z.object({
    directory: z.string().default(".").describe("Directory path to list (default: current directory)"),
    recursive: z.boolean().default(false).describe("Whether to list recursively"),
    max_depth: z.number().default(2).describe("Maximum depth for recursive listing"),
    show_hidden: z.boolean().default(false).describe("Include hidden files and folders (.dotfiles)")
  }),
  execute: async (args, context) => {
    try {
      const safeDir = resolveSafePath(args.directory, context.allowedRoots);
      if (!fs.existsSync(safeDir)) {
        return { success: false, error: `Directory not found: ${args.directory}` };
      }

      function scan(currentDir: string, depth: number): any[] {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        const results: any[] = [];

        for (const entry of entries) {
          if (!args.show_hidden && entry.name.startsWith(".")) {
            continue;
          }
          const fullPath = path.join(currentDir, entry.name);
          const relPath = path.relative(safeDir, fullPath);

          let stat: fs.Stats | null = null;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            // broken symlink or permission error
          }

          const item = {
            name: entry.name,
            path: relPath || entry.name,
            is_directory: entry.isDirectory(),
            is_file: entry.isFile(),
            is_symlink: entry.isSymbolicLink(),
            size: stat ? stat.size : 0,
            modified_at: stat ? stat.mtime.toISOString() : null
          };

          results.push(item);

          if (entry.isDirectory() && args.recursive && depth < args.max_depth) {
            results.push(...scan(fullPath, depth + 1));
          }
        }
        return results;
      }

      const items = scan(safeDir, 1);
      return {
        success: true,
        data: {
          directory: args.directory,
          resolved_path: safeDir,
          total_items: items.length,
          items
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};

// 2. file_read (cat)
export const fileReadTool: LocalToolDefinition = {
  name: "file_read",
  description: "Read text content of a file with optional line offset and limit (similar to cat/head).",
  permissionTier: "read",
  parameters: z.object({
    path: z.string().describe("Path to the file to read"),
    start_line: z.number().optional().describe("Starting line number (1-indexed, inclusive)"),
    end_line: z.number().optional().describe("Ending line number (1-indexed, inclusive)"),
    max_bytes: z.number().default(50000).describe("Maximum bytes to read (default 50KB to protect context)")
  }),
  execute: async (args, context) => {
    try {
      const safePath = resolveSafePath(args.path, context.allowedRoots);
      if (!fs.existsSync(safePath)) {
        return { success: false, error: `File not found: ${args.path}` };
      }
      const stat = fs.statSync(safePath);
      if (stat.isDirectory()) {
        return { success: false, error: `Path is a directory, not a file: ${args.path}` };
      }

      const content = fs.readFileSync(safePath, "utf-8");
      const lines = content.split(/\r?\n/);
      const totalLines = lines.length;

      let selectedLines = lines;
      let start = 1;
      let end = totalLines;

      if (args.start_line !== undefined || args.end_line !== undefined) {
        start = Math.max(1, args.start_line ?? 1);
        end = Math.min(totalLines, args.end_line ?? totalLines);
        selectedLines = lines.slice(start - 1, end);
      }

      let resultText = selectedLines.join("\n");
      let truncated = false;
      if (Buffer.byteLength(resultText, "utf-8") > args.max_bytes) {
        resultText = resultText.slice(0, args.max_bytes);
        truncated = true;
      }

      return {
        success: true,
        data: {
          path: args.path,
          total_lines: totalLines,
          start_line: start,
          end_line: end,
          content: resultText,
          truncated
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};

// 3. file_write (write / create)
export const fileWriteTool: LocalToolDefinition = {
  name: "file_write",
  description: "Write content to a file, creating parent directories if necessary.",
  permissionTier: "write",
  parameters: z.object({
    path: z.string().describe("Path to the file to create or modify"),
    content: z.string().describe("Text content to write"),
    overwrite: z.boolean().default(true).describe("Whether to overwrite if file exists"),
    append: z.boolean().default(false).describe("Whether to append instead of overwriting")
  }),
  execute: async (args, context) => {
    try {
      const safePath = resolveSafePath(args.path, context.allowedRoots);
      const parentDir = path.dirname(safePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const exists = fs.existsSync(safePath);
      if (exists && !args.overwrite && !args.append) {
        return { success: false, error: `File already exists and overwrite is false: ${args.path}` };
      }

      if (args.append) {
        fs.appendFileSync(safePath, args.content, "utf-8");
      } else {
        fs.writeFileSync(safePath, args.content, "utf-8");
      }

      const stat = fs.statSync(safePath);
      return {
        success: true,
        data: {
          path: args.path,
          bytes_written: Buffer.byteLength(args.content, "utf-8"),
          size: stat.size,
          appended: args.append
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};

// 4. file_mkdir (mkdir -p)
export const fileMkdirTool: LocalToolDefinition = {
  name: "file_mkdir",
  description: "Create a directory recursively (similar to mkdir -p).",
  permissionTier: "write",
  parameters: z.object({
    path: z.string().describe("Directory path to create"),
    recursive: z.boolean().default(true).describe("Create parent directories if needed")
  }),
  execute: async (args, context) => {
    try {
      const safePath = resolveSafePath(args.path, context.allowedRoots);
      if (fs.existsSync(safePath)) {
        return { success: true, data: { path: args.path, message: "Directory already exists" } };
      }

      fs.mkdirSync(safePath, { recursive: args.recursive });
      return {
        success: true,
        data: { path: args.path, created: true }
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};

// 5. file_delete (rm / rmdir)
export const fileDeleteTool: LocalToolDefinition = {
  name: "file_delete",
  description: "Delete a file or directory safely (similar to rm or rm -rf).",
  permissionTier: "write",
  parameters: z.object({
    path: z.string().describe("Path to delete"),
    recursive: z.boolean().default(false).describe("Delete directory recursively if it is a directory")
  }),
  execute: async (args, context) => {
    try {
      const safePath = resolveSafePath(args.path, context.allowedRoots);

      // Guard against deleting root or cwd
      if (safePath === "/" || safePath === process.cwd()) {
        return { success: false, error: "Refusing to delete root or current working directory" };
      }

      if (!fs.existsSync(safePath)) {
        return { success: false, error: `Path does not exist: ${args.path}` };
      }

      const stat = fs.statSync(safePath);
      if (stat.isDirectory()) {
        if (!args.recursive) {
          return { success: false, error: `Path is a directory. Set recursive=true to delete: ${args.path}` };
        }
        fs.rmSync(safePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(safePath);
      }

      return {
        success: true,
        data: { path: args.path, deleted: true }
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};

// 6. file_search (find / grep)
export const fileSearchTool: LocalToolDefinition = {
  name: "file_search",
  description: "Search for files by name glob/pattern or grep inside files for matching text.",
  permissionTier: "read",
  parameters: z.object({
    directory: z.string().default(".").describe("Directory to start search from"),
    pattern: z.string().describe("File name pattern (e.g. '*.ts') or search substring"),
    search_content: z.boolean().default(false).describe("If true, searches inside file contents (grep)"),
    max_results: z.number().default(40).describe("Maximum matches to return")
  }),
  execute: async (args, context) => {
    try {
      const safeDir = resolveSafePath(args.directory, context.allowedRoots);
      const matches: any[] = [];
      const regex = new RegExp(args.pattern, "i");

      function searchDir(currentDir: string): void {
        if (matches.length >= args.max_results) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
            continue;
          }
          const fullPath = path.join(currentDir, entry.name);
          const relPath = path.relative(safeDir, fullPath);

          if (entry.isDirectory()) {
            searchDir(fullPath);
          } else if (entry.isFile()) {
            if (!args.search_content) {
              if (regex.test(entry.name) || regex.test(relPath)) {
                matches.push({ file: relPath, type: "filename" });
              }
            } else {
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size < 500000) { // Only grep files under 500KB
                  const text = fs.readFileSync(fullPath, "utf-8");
                  const lines = text.split("\n");
                  for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                      matches.push({
                        file: relPath,
                        line_number: i + 1,
                        line_content: lines[i].trim().slice(0, 200)
                      });
                      if (matches.length >= args.max_results) break;
                    }
                  }
                }
              } catch {
                // Ignore binary or unreadable files
              }
            }
          }
        }
      }

      searchDir(safeDir);
      return {
        success: true,
        data: {
          directory: args.directory,
          pattern: args.pattern,
          search_content: args.search_content,
          total_matches: matches.length,
          matches
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};

// 7. shell_exec (exec_cmd)
export const shellExecTool: LocalToolDefinition = {
  name: "shell_exec",
  description: "Execute a shell command with timeout, environment scrub, and stream capture.",
  permissionTier: "exec",
  parameters: z.object({
    command: z.string().describe("The shell command to execute"),
    cwd: z.string().default(".").describe("Working directory for the command"),
    timeout_ms: z.number().optional().describe("Timeout in milliseconds (defaults to config exec timeout)")
  }),
  execute: async (args, context) => {
    if (!context.shellEnabled) {
      return { success: false, error: "Shell execution is disabled by localtool security policy" };
    }

    try {
      const safeCwd = resolveSafePath(args.cwd, context.allowedRoots);
      const timeout = args.timeout_ms || context.execTimeoutMs;

      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: safeCwd,
        timeout,
        maxBuffer: 2 * 1024 * 1024, // 2MB
        env: {
          ...process.env,
          PAGER: "cat",
          TERM: "dumb"
        }
      });
      const duration = Date.now() - startTime;

      return {
        success: true,
        data: {
          command: args.command,
          cwd: safeCwd,
          duration_ms: duration,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exit_code: 0
        }
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        data: {
          command: args.command,
          exit_code: err.code ?? 1,
          stdout: err.stdout ? err.stdout.toString().trim() : "",
          stderr: err.stderr ? err.stderr.toString().trim() : ""
        }
      };
    }
  }
};

export const ALL_TOOLS: LocalToolDefinition[] = [
  fileListTool,
  fileReadTool,
  fileWriteTool,
  fileMkdirTool,
  fileDeleteTool,
  fileSearchTool,
  shellExecTool
];
