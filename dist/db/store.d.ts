export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type JobMode = "sync" | "async";
export type TransportType = "mcp" | "ws";
export interface JobRecord {
    id: string;
    idempotency_key: string | null;
    instruction: string;
    mode: JobMode;
    status: JobStatus;
    result: string | null;
    error: string | null;
    model: string;
    transport: TransportType;
    created_at: number;
    updated_at: number;
    duration_ms: number | null;
}
export interface JobEventRecord {
    id?: number;
    job_id: string;
    event_type: "status_change" | "step" | "tool_call" | "tool_result" | "log";
    payload: any;
    timestamp: number;
}
export interface AuditRecord {
    id?: number;
    timestamp: number;
    transport: string;
    tool_name: string;
    args: any;
    status: "success" | "error";
    duration_ms: number;
    error: string | null;
}
export declare class JobStore {
    private db;
    constructor(dbPath?: string);
    private initTables;
    createJob(params: {
        instruction: string;
        mode?: JobMode;
        model: string;
        transport: TransportType;
        idempotency_key?: string;
    }): {
        job: JobRecord;
        isExisting: boolean;
    };
    getJob(id: string): JobRecord | null;
    getJobByIdempotencyKey(key: string): JobRecord | null;
    listJobs(limit?: number, status?: JobStatus): JobRecord[];
    updateJobStatus(id: string, status: JobStatus, result?: any, error?: string): void;
    cancelJob(id: string): boolean;
    appendJobEvent(job_id: string, event_type: JobEventRecord["event_type"], payload: any): void;
    getJobEvents(job_id: string): JobEventRecord[];
    logAudit(record: Omit<AuditRecord, "id">): void;
    getRecentAuditLogs(limit?: number): AuditRecord[];
    close(): void;
}
