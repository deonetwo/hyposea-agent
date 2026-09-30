import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SessionRecord } from './types.js';

export interface SessionStoreOptions {
  dbPath?: string;
  inMemory?: boolean;
}

export class SessionStore {
  private db: DatabaseType;

  constructor(options: SessionStoreOptions = {}) {
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
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 1,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
    `);
  }

  public get(id: string): SessionRecord | null {
    const row = this.db.prepare<[string], any>(
      'SELECT id, conversation_id, created_at, updated_at, message_count, metadata FROM sessions WHERE id = ?'
    ).get(id);

    if (!row) return null;

    let metadata: Record<string, any> | undefined;
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        metadata = undefined;
      }
    }

    return {
      id: row.id,
      conversationId: row.conversation_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      metadata
    };
  }

  public getConversationId(id: string): string | null {
    const row = this.db.prepare<[string], { conversation_id: string }>(
      'SELECT conversation_id FROM sessions WHERE id = ?'
    ).get(id);
    return row ? row.conversation_id : null;
  }

  public set(id: string, conversationId: string, metadata?: Record<string, any>): void {
    const now = Date.now();
    const existing = this.get(id);
    const metaString = metadata ? JSON.stringify(metadata) : (existing?.metadata ? JSON.stringify(existing.metadata) : null);

    if (existing) {
      this.db.prepare(
        `UPDATE sessions 
         SET conversation_id = ?, updated_at = ?, message_count = message_count + 1, metadata = ? 
         WHERE id = ?`
      ).run(conversationId, now, metaString, id);
    } else {
      this.db.prepare(
        `INSERT INTO sessions (id, conversation_id, created_at, updated_at, message_count, metadata) 
         VALUES (?, ?, ?, ?, 1, ?)`
      ).run(id, conversationId, now, now, metaString);
    }
  }

  public touch(id: string): void {
    const now = Date.now();
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, id);
  }

  public delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return res.changes > 0;
  }

  public clear(): void {
    this.db.prepare('DELETE FROM sessions').run();
  }

  public list(): SessionRecord[] {
    const rows = this.db.prepare<[], any>(
      'SELECT id, conversation_id, created_at, updated_at, message_count, metadata FROM sessions ORDER BY updated_at DESC'
    ).all();

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  public prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const res = this.db.prepare('DELETE FROM sessions WHERE updated_at < ?').run(cutoff);
    return res.changes;
  }

  public close(): void {
    this.db.close();
  }
}
