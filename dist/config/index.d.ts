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
export declare function getDefaultDbPath(): string;
export declare function loadConfig(overrides?: Partial<LocalToolConfig>): LocalToolConfig;
