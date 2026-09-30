import path from 'node:path';
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { getHyposeaPaths } from '../../config/paths.js';

export interface OutboxNotification {
  id: number;
  message: string;
  targetChannelId?: string;
  status: 'pending' | 'sent' | 'failed';
  createdAt: number;
}

export class NotifyService {
  private db: DatabaseType;

  constructor(baseDir?: string) {
    const paths = getHyposeaPaths(baseDir);
    const dir = path.dirname(paths.dbFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(paths.dbFile);
    this.init();
  }

  private init(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT NOT NULL,
        target_channel_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notify_status ON notifications_outbox(status);
    `);
  }

  public enqueueMessage(message: string, targetChannelId?: string): number {
    const res = this.db.prepare(
      'INSERT INTO notifications_outbox (message, target_channel_id, status, created_at) VALUES (?, ?, ?, ?)'
    ).run(message, targetChannelId || null, 'pending', Date.now());

    return Number(res.lastInsertRowid);
  }

  public getPendingNotifications(): OutboxNotification[] {
    const rows = this.db.prepare<[], any>(
      "SELECT id, message, target_channel_id, status, created_at FROM notifications_outbox WHERE status = 'pending' ORDER BY id ASC"
    ).all();

    return rows.map((r) => ({
      id: r.id,
      message: r.message,
      targetChannelId: r.target_channel_id || undefined,
      status: r.status,
      createdAt: r.created_at
    }));
  }

  public markNotificationSent(id: number): void {
    this.db.prepare("UPDATE notifications_outbox SET status = 'sent' WHERE id = ?").run(id);
  }

  public markNotificationFailed(id: number): void {
    this.db.prepare("UPDATE notifications_outbox SET status = 'failed' WHERE id = ?").run(id);
  }

  public close(): void {
    this.db.close();
  }
}

export function createNotifyServer(service?: NotifyService): McpServer {
  const notify = service || new NotifyService();
  const server = new McpServer({
    name: 'hyposea-notify',
    version: '1.0.0'
  });

  server.tool(
    'send_message',
    'Proactively send a message or notification to the owner on Discord',
    {
      message: z.string().describe('The content of the message to send to the owner'),
      channel: z.string().optional().describe('Optional target channel snowflake ID (defaults to owner DM)')
    },
    async ({ message, channel }) => {
      const id = notify.enqueueMessage(message, channel);
      return {
        content: [{ type: 'text', text: `Message queued for delivery to owner (Notice ID: ${id}).` }]
      };
    }
  );

  return server;
}

export async function startNotifyServerStdio(): Promise<void> {
  const server = createNotifyServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
