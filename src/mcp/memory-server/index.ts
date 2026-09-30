import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { getHyposeaPaths } from '../../config/paths.js';

const MAX_FILE_BYTES = 15 * 1024; // 15 KB hard budget per file

export class MemoryService {
  private memoryDir: string;
  private memoryFile: string;
  private userFile: string;
  private db: DatabaseType;

  constructor(baseDir?: string) {
    const paths = getHyposeaPaths(baseDir);
    this.memoryDir = paths.memoryDir;
    this.memoryFile = path.join(this.memoryDir, 'MEMORY.md');
    this.userFile = path.join(this.memoryDir, 'USER.md');

    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }

    if (!fs.existsSync(this.memoryFile)) {
      fs.writeFileSync(this.memoryFile, '# Persistent Memory & Facts\n\n', 'utf8');
    }

    if (!fs.existsSync(this.userFile)) {
      fs.writeFileSync(this.userFile, '# User Profile & Preferences\n\n', 'utf8');
    }

    const dir = path.dirname(paths.dbFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(paths.dbFile);
    this.initFts();
  }

  private initFts(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
        session_id,
        role,
        content,
        timestamp UNINDEXED
      );
    `);
  }

  public recordTurn(sessionId: string, role: string, content: string): void {
    try {
      this.db.prepare(
        'INSERT INTO conversation_fts (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)'
      ).run(sessionId, role, content, Date.now());
    } catch (err: any) {
      console.error('[MemoryService] Failed to index turn into FTS5:', err.message);
    }
  }

  public remember(category: 'fact' | 'decision' | 'preference', text: string): { success: boolean; message: string } {
    const targetFile = category === 'preference' ? this.userFile : this.memoryFile;
    const current = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';

    if (Buffer.byteLength(current, 'utf8') > MAX_FILE_BYTES) {
      return {
        success: false,
        message: `Memory file budget exceeded (${MAX_FILE_BYTES} bytes limit). Please run forget to prune old entries first.`
      };
    }

    const entry = `• [${new Date().toISOString().split('T')[0]}] [${category.toUpperCase()}] ${text.trim()}\n`;
    fs.appendFileSync(targetFile, entry, 'utf8');

    return {
      success: true,
      message: `Remembered in ${path.basename(targetFile)}: "${text}"`
    };
  }

  public forget(query: string): { success: boolean; removedCount: number } {
    const cleanQuery = query.toLowerCase().trim();
    let totalRemoved = 0;

    for (const file of [this.memoryFile, this.userFile]) {
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const filtered = lines.filter((l) => {
        if (l.trim().startsWith('•') && l.toLowerCase().includes(cleanQuery)) {
          totalRemoved++;
          return false;
        }
        return true;
      });
      fs.writeFileSync(file, filtered.join('\n'), 'utf8');
    }

    return {
      success: true,
      removedCount: totalRemoved
    };
  }

  public searchSessions(query: string, limit = 5): Array<{ sessionId: string; role: string; content: string }> {
    try {
      // Sanitize query for FTS5
      const sanitized = query.replace(/[^\w\s]/g, ' ').trim();
      if (!sanitized) return [];

      const rows = this.db.prepare<[string, number], any>(
        'SELECT session_id, role, content FROM conversation_fts WHERE conversation_fts MATCH ? ORDER BY rank LIMIT ?'
      ).all(sanitized, limit);

      return rows.map((r) => ({
        sessionId: r.session_id,
        role: r.role,
        content: r.content
      }));
    } catch {
      return [];
    }
  }

  public getContext(): string {
    let ctx = '';
    if (fs.existsSync(this.userFile)) {
      const userContent = fs.readFileSync(this.userFile, 'utf8').trim();
      if (userContent) ctx += `${userContent}\n\n`;
    }
    if (fs.existsSync(this.memoryFile)) {
      const memContent = fs.readFileSync(this.memoryFile, 'utf8').trim();
      if (memContent) ctx += `${memContent}\n\n`;
    }
    return ctx.trim();
  }

  public close(): void {
    this.db.close();
  }
}

export function createMemoryServer(service?: MemoryService): McpServer {
  const mem = service || new MemoryService();
  const server = new McpServer({
    name: 'hyposea-memory',
    version: '1.0.0'
  });

  server.tool(
    'remember',
    'Store an important user preference, project decision, or factual constraint into persistent memory',
    {
      category: z.enum(['fact', 'decision', 'preference']).describe('Category of memory entry'),
      text: z.string().describe('Clear, concise description to remember')
    },
    async ({ category, text }) => {
      const result = mem.remember(category, text);
      return {
        content: [{ type: 'text', text: result.message }]
      };
    }
  );

  server.tool(
    'forget',
    'Remove entries from persistent memory matching a keyword or phrase',
    {
      query: z.string().describe('Keyword or phrase to search for and delete from memory files')
    },
    async ({ query }) => {
      const result = mem.forget(query);
      return {
        content: [{ type: 'text', text: `Removed ${result.removedCount} matching memory entries.` }]
      };
    }
  );

  server.tool(
    'search_sessions',
    'Perform full-text search across past conversations and turns using SQLite FTS5',
    {
      query: z.string().describe('Search query keyword'),
      limit: z.number().optional().describe('Maximum number of results to return (default 5)')
    },
    async ({ query, limit }) => {
      const matches = mem.searchSessions(query, limit || 5);
      if (matches.length === 0) {
        return {
          content: [{ type: 'text', text: 'No matching sessions or turns found.' }]
        };
      }

      const text = matches
        .map((m, i) => `${i + 1}. [Session: ${m.sessionId}] (${m.role}): ${m.content.slice(0, 200)}`)
        .join('\n\n');

      return {
        content: [{ type: 'text', text }]
      };
    }
  );

  return server;
}

export async function startMemoryServerStdio(): Promise<void> {
  const server = createMemoryServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
