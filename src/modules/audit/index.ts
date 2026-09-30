import crypto from 'node:crypto';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { EventBus } from '../../core/events.js';
import { AppConfig } from '../../config.js';

export interface AuditRecord {
  id?: number;
  timestamp: number;
  authorId: string;
  authorName: string;
  sessionKey: string;
  promptPreview: string;
  promptHash: string;
  durationMs: number;
  tokensUsed?: number;
  status: 'success' | 'aborted' | 'error';
  error?: string;
}

export interface AuditModuleOptions {
  dbPath?: string;
  inMemory?: boolean;
}

export class AuditModule {
  public readonly name = 'audit';
  private db: DatabaseType;

  constructor(options: AuditModuleOptions = {}) {
    if (options.inMemory) {
      this.db = new Database(':memory:');
    } else {
      const dbPath = options.dbPath || path.resolve(process.cwd(), 'data', 'hyposea.db');
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(dbPath);
    }

    this.init();
  }

  private init(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT,
        session_key TEXT NOT NULL,
        prompt_preview TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        tokens_used INTEGER,
        status TEXT NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_author ON audit_logs(author_id);
    `);
  }

  public register(bus: EventBus): () => void {
    const unbindAfter = bus.on('run.after', (data) => {
      this.record({
        timestamp: Date.now(),
        authorId: data.message.authorId,
        authorName: data.message.authorName,
        sessionKey: data.sessionKey,
        promptPreview: data.prompt.length > 120 ? data.prompt.slice(0, 117) + '...' : data.prompt,
        promptHash: crypto.createHash('sha256').update(data.prompt).digest('hex').slice(0, 16),
        durationMs: data.durationMs,
        tokensUsed: data.result.tokensUsed,
        status: data.result.aborted ? 'aborted' : data.result.error ? 'error' : 'success',
        error: data.result.error
      });
    });

    const unbindAborted = bus.on('run.aborted', (data) => {
      this.record({
        timestamp: Date.now(),
        authorId: data.message.authorId,
        authorName: data.message.authorName,
        sessionKey: data.sessionKey,
        promptPreview: data.message.content.length > 120 ? data.message.content.slice(0, 117) + '...' : data.message.content,
        promptHash: crypto.createHash('sha256').update(data.message.content).digest('hex').slice(0, 16),
        durationMs: 0,
        status: 'aborted',
        error: data.reason || 'Aborted by user'
      });
    });

    const unbindError = bus.on('run.error', (data) => {
      this.record({
        timestamp: Date.now(),
        authorId: data.message.authorId,
        authorName: data.message.authorName,
        sessionKey: data.sessionKey,
        promptPreview: data.message.content.length > 120 ? data.message.content.slice(0, 117) + '...' : data.message.content,
        promptHash: crypto.createHash('sha256').update(data.message.content).digest('hex').slice(0, 16),
        durationMs: data.durationMs,
        status: 'error',
        error: data.error
      });
    });

    return () => {
      unbindAfter();
      unbindAborted();
      unbindError();
    };
  }

  public record(record: AuditRecord): void {
    this.db.prepare(`
      INSERT INTO audit_logs (
        timestamp, author_id, author_name, session_key, 
        prompt_preview, prompt_hash, duration_ms, tokens_used, status, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.timestamp,
      record.authorId,
      record.authorName,
      record.sessionKey,
      record.promptPreview,
      record.promptHash,
      record.durationMs,
      record.tokensUsed || null,
      record.status,
      record.error || null
    );
  }

  public getRecentLogs(limit = 20): AuditRecord[] {
    const rows = this.db.prepare<[number], any>(
      'SELECT id, timestamp, author_id, author_name, session_key, prompt_preview, prompt_hash, duration_ms, tokens_used, status, error FROM audit_logs ORDER BY timestamp DESC LIMIT ?'
    ).all(limit);

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      authorId: r.author_id,
      authorName: r.author_name,
      sessionKey: r.session_key,
      promptPreview: r.prompt_preview,
      promptHash: r.prompt_hash,
      durationMs: r.duration_ms,
      tokensUsed: r.tokens_used,
      status: r.status,
      error: r.error
    }));
  }

  public getStats(): { totalRuns: number; totalTokens: number; errorCount: number } {
    const row = this.db.prepare<[], any>(`
      SELECT 
        COUNT(*) as totalRuns,
        SUM(COALESCE(tokens_used, 0)) as totalTokens,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errorCount
      FROM audit_logs
    `).get();

    return {
      totalRuns: row?.totalRuns || 0,
      totalTokens: row?.totalTokens || 0,
      errorCount: row?.errorCount || 0
    };
  }

  public close(): void {
    this.db.close();
  }
}
