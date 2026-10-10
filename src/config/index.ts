import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

export interface LocalToolConfig {
  /** LM Studio base URL (defaults to http://127.0.0.1:1234) */
  lmStudioUrl: string;
  /** Preferred or default model name to route tasks to */
  defaultModel: string;
  /** List of allowed/supported LM Studio models */
  models: string[];
  /** Host interface to bind to ('127.0.0.1' for local only, '0.0.0.0' for LAN) */
  host: string;
  /** Whether LAN access is enabled */
  listenLan: boolean;
  /** WebSocket server port */
  wsPort: number;
  /** MCP HTTP/SSE port if running in HTTP mode */
  mcpHttpPort: number;
  /** Authentication token for WebSocket connections */
  authToken: string;
  /** Allowed root directories for file operations and shell exec (defaults to cwd) */
  allowedRoots: string[];
  /** Whether shell command execution is enabled */
  shellEnabled: boolean;
  /** Default command execution timeout in milliseconds */
  execTimeoutMs: number;
  /** Path to SQLite database file */
  dbPath: string;
  /** Target agent client profile ('antigravity' | 'claude-code' | 'both') */
  clientProfile: "antigravity" | "claude-code" | "both";
  /** Maximum autonomous worker loop steps */
  maxWorkerSteps: number;
}

const DEFAULT_MODELS = [
  "qwen/qwen3-30b-a3b-2507",
  "mistralai/devstral-small-2-2512",
  "qwen/qwen3-coder-30b",
  "openai/gpt-oss-20b",
  "mistralai/ministral-3-14b-reasoning",
  "liquid/lfm2.5-1.2b",
  "essentialai/rnj-1",
  "prism-ml/bonsai-27b",
  "google/gemma-4-e4b"
];

export function getDefaultDbPath(): string {
  const home = os.homedir();
  const dir = path.join(home, ".localtool");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Fallback to local directory if home cannot be written
      return path.resolve(process.cwd(), ".localtool.db");
    }
  }
  return path.join(dir, "localtool.db");
}

export function loadConfig(overrides: Partial<LocalToolConfig> = {}): LocalToolConfig {
  // Check if a local config.json exists in cwd or home
  let fileConfig: Partial<LocalToolConfig> = {};
  const cwdConfig = path.resolve(process.cwd(), "config.json");
  const homeConfig = path.join(os.homedir(), ".localtool", "config.json");

  if (fs.existsSync(cwdConfig)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(cwdConfig, "utf-8"));
    } catch (err) {
      console.warn(`[Config] Warning: Failed to parse ${cwdConfig}:`, err);
    }
  } else if (fs.existsSync(homeConfig)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(homeConfig, "utf-8"));
    } catch (err) {
      console.warn(`[Config] Warning: Failed to parse ${homeConfig}:`, err);
    }
  }

  const listenLan = overrides.listenLan ?? fileConfig.listenLan ?? (process.env.LOCALTOOL_LAN === "true" || process.env.LOCALTOOL_LAN === "1");
  const host = overrides.host ?? fileConfig.host ?? (listenLan ? "0.0.0.0" : "127.0.0.1");

  const cwd = process.cwd();
  const allowedRoots = overrides.allowedRoots ?? fileConfig.allowedRoots ?? [cwd];

  return {
    lmStudioUrl: overrides.lmStudioUrl ?? fileConfig.lmStudioUrl ?? process.env.LMSTUDIO_URL ?? "http://127.0.0.1:1234",
    defaultModel: overrides.defaultModel ?? fileConfig.defaultModel ?? process.env.LOCALTOOL_MODEL ?? "qwen/qwen3-coder-30b",
    models: overrides.models ?? fileConfig.models ?? DEFAULT_MODELS,
    host,
    listenLan,
    wsPort: overrides.wsPort ?? fileConfig.wsPort ?? parseInt(process.env.LOCALTOOL_WS_PORT || "3334", 10),
    mcpHttpPort: overrides.mcpHttpPort ?? fileConfig.mcpHttpPort ?? parseInt(process.env.LOCALTOOL_MCP_PORT || "3333", 10),
    authToken: overrides.authToken ?? fileConfig.authToken ?? process.env.LOCALTOOL_AUTH_TOKEN ?? "localtool-secret-token",
    allowedRoots,
    shellEnabled: overrides.shellEnabled ?? fileConfig.shellEnabled ?? true,
    execTimeoutMs: overrides.execTimeoutMs ?? fileConfig.execTimeoutMs ?? 60000,
    dbPath: overrides.dbPath ?? fileConfig.dbPath ?? process.env.LOCALTOOL_DB_PATH ?? getDefaultDbPath(),
    clientProfile: overrides.clientProfile ?? fileConfig.clientProfile ?? "both",
    maxWorkerSteps: overrides.maxWorkerSteps ?? fileConfig.maxWorkerSteps ?? 10
  };
}
