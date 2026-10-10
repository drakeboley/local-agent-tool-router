import { DatabaseSync } from "node:sqlite";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
export class JobStore {
    db;
    constructor(dbPath = ":memory:") {
        if (dbPath !== ":memory:") {
            const dir = path.dirname(dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
        this.db = new DatabaseSync(dbPath);
        this.initTables();
    }
    initTables() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        instruction TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        model TEXT NOT NULL,
        transport TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        duration_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_job_id ON job_events(job_id);

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        transport TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        args TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp DESC);
    `);
    }
    createJob(params) {
        const now = Date.now();
        if (params.idempotency_key) {
            const existing = this.getJobByIdempotencyKey(params.idempotency_key);
            if (existing) {
                return { job: existing, isExisting: true };
            }
        }
        const id = `job_${crypto.randomBytes(8).toString("hex")}`;
        const mode = params.mode || "sync";
        const status = "pending";
        const stmt = this.db.prepare(`
      INSERT INTO jobs (id, idempotency_key, instruction, mode, status, result, error, model, transport, created_at, updated_at, duration_ms)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL)
    `);
        stmt.run(id, params.idempotency_key ?? null, params.instruction, mode, status, params.model, params.transport, now, now);
        const job = this.getJob(id);
        this.appendJobEvent(id, "status_change", { status: "pending" });
        return { job, isExisting: false };
    }
    getJob(id) {
        const stmt = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`);
        const row = stmt.get(id);
        return row ? row : null;
    }
    getJobByIdempotencyKey(key) {
        const stmt = this.db.prepare(`SELECT * FROM jobs WHERE idempotency_key = ?`);
        const row = stmt.get(key);
        return row ? row : null;
    }
    listJobs(limit = 20, status) {
        if (status) {
            const stmt = this.db.prepare(`SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?`);
            return stmt.all(status, limit);
        }
        const stmt = this.db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`);
        return stmt.all(limit);
    }
    updateJobStatus(id, status, result, error) {
        const job = this.getJob(id);
        if (!job)
            return;
        const now = Date.now();
        const duration = now - job.created_at;
        const resultStr = result !== undefined ? JSON.stringify(result) : job.result;
        const errorStr = error !== undefined ? error : job.error;
        const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = ?, result = ?, error = ?, updated_at = ?, duration_ms = ?
      WHERE id = ?
    `);
        stmt.run(status, resultStr, errorStr, now, duration, id);
        this.appendJobEvent(id, "status_change", { status, error: errorStr });
    }
    cancelJob(id) {
        const job = this.getJob(id);
        if (!job || job.status === "completed" || job.status === "failed") {
            return false;
        }
        this.updateJobStatus(id, "cancelled", null, "Cancelled by user/agent");
        return true;
    }
    appendJobEvent(job_id, event_type, payload) {
        const stmt = this.db.prepare(`
      INSERT INTO job_events (job_id, event_type, payload, timestamp)
      VALUES (?, ?, ?, ?)
    `);
        stmt.run(job_id, event_type, JSON.stringify(payload), Date.now());
    }
    getJobEvents(job_id) {
        const stmt = this.db.prepare(`
      SELECT * FROM job_events WHERE job_id = ? ORDER BY timestamp ASC
    `);
        const rows = stmt.all(job_id);
        return rows.map((r) => ({
            id: r.id,
            job_id: r.job_id,
            event_type: r.event_type,
            payload: JSON.parse(r.payload),
            timestamp: r.timestamp
        }));
    }
    logAudit(record) {
        const stmt = this.db.prepare(`
      INSERT INTO audit_log (timestamp, transport, tool_name, args, status, duration_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(record.timestamp, record.transport, record.tool_name, JSON.stringify(record.args), record.status, record.duration_ms, record.error ?? null);
    }
    getRecentAuditLogs(limit = 50) {
        const stmt = this.db.prepare(`
      SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?
    `);
        const rows = stmt.all(limit);
        return rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            transport: r.transport,
            tool_name: r.tool_name,
            args: JSON.parse(r.args),
            status: r.status,
            duration_ms: r.duration_ms,
            error: r.error
        }));
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=store.js.map