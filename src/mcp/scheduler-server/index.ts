import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { getHyposeaPaths } from '../../config/paths.js';

export interface ScheduledJob {
  id: string;
  task: string;
  intervalMinutes?: number;
  isRecurring: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  runsToday: number;
  maxDailyRuns: number;
  targetChannelId?: string;
  enabled: boolean;
  createdAt: number;
}

export class SchedulerService {
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
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        interval_minutes INTEGER,
        is_recurring INTEGER NOT NULL DEFAULT 0,
        next_run_at INTEGER NOT NULL,
        last_run_at INTEGER,
        runs_today INTEGER NOT NULL DEFAULT 0,
        max_daily_runs INTEGER NOT NULL DEFAULT 10,
        target_channel_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON scheduled_jobs(next_run_at, enabled);
    `);
  }

  public scheduleTask(params: {
    task: string;
    delayMinutes?: number;
    intervalMinutes?: number;
    isRecurring?: boolean;
    targetChannelId?: string;
  }): { success: boolean; job?: ScheduledJob; message: string } {
    const isRecurring = Boolean(params.isRecurring);
    const intervalMinutes = params.intervalMinutes || 60;

    // Minimum interval guard: at least 15 minutes to protect LLM quota
    if (isRecurring && intervalMinutes < 15) {
      return {
        success: false,
        message: 'Minimum recurring interval is 15 minutes to prevent burning AGY token quota.'
      };
    }

    const id = `job_${crypto.randomBytes(4).toString('hex')}`;
    const delay = params.delayMinutes ?? (isRecurring ? intervalMinutes : 5);
    const nextRunAt = Date.now() + delay * 60 * 1000;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO scheduled_jobs (
        id, task, interval_minutes, is_recurring, next_run_at, 
        runs_today, max_daily_runs, target_channel_id, enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, 10, ?, 1, ?)
    `).run(
      id,
      params.task,
      isRecurring ? intervalMinutes : null,
      isRecurring ? 1 : 0,
      nextRunAt,
      params.targetChannelId || null,
      now
    );

    const job = this.getJob(id);
    return {
      success: true,
      job: job || undefined,
      message: `Scheduled task "${params.task}" (ID: ${id}) for execution at ${new Date(nextRunAt).toISOString()}`
    };
  }

  public listJobs(): ScheduledJob[] {
    const rows = this.db.prepare<[], any>(
      'SELECT id, task, interval_minutes, is_recurring, next_run_at, last_run_at, runs_today, max_daily_runs, target_channel_id, enabled, created_at FROM scheduled_jobs WHERE enabled = 1 ORDER BY next_run_at ASC'
    ).all();

    return rows.map((r) => ({
      id: r.id,
      task: r.task,
      intervalMinutes: r.interval_minutes || undefined,
      isRecurring: Boolean(r.is_recurring),
      nextRunAt: r.next_run_at,
      lastRunAt: r.last_run_at || undefined,
      runsToday: r.runs_today,
      maxDailyRuns: r.max_daily_runs,
      targetChannelId: r.target_channel_id || undefined,
      enabled: Boolean(r.enabled),
      createdAt: r.created_at
    }));
  }

  public cancelJob(id: string): boolean {
    const res = this.db.prepare('UPDATE scheduled_jobs SET enabled = 0 WHERE id = ?').run(id);
    return res.changes > 0;
  }

  public getJob(id: string): ScheduledJob | null {
    const r = this.db.prepare<[string], any>('SELECT * FROM scheduled_jobs WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id,
      task: r.task,
      intervalMinutes: r.interval_minutes || undefined,
      isRecurring: Boolean(r.is_recurring),
      nextRunAt: r.next_run_at,
      lastRunAt: r.last_run_at || undefined,
      runsToday: r.runs_today,
      maxDailyRuns: r.max_daily_runs,
      targetChannelId: r.target_channel_id || undefined,
      enabled: Boolean(r.enabled),
      createdAt: r.created_at
    };
  }

  public getDueJobs(): ScheduledJob[] {
    const now = Date.now();
    const rows = this.db.prepare<[number], any>(
      'SELECT * FROM scheduled_jobs WHERE enabled = 1 AND next_run_at <= ?'
    ).all(now);

    return rows.map((r) => ({
      id: r.id,
      task: r.task,
      intervalMinutes: r.interval_minutes || undefined,
      isRecurring: Boolean(r.is_recurring),
      nextRunAt: r.next_run_at,
      lastRunAt: r.last_run_at || undefined,
      runsToday: r.runs_today,
      maxDailyRuns: r.max_daily_runs,
      targetChannelId: r.target_channel_id || undefined,
      enabled: Boolean(r.enabled),
      createdAt: r.created_at
    }));
  }

  public markJobExecuted(job: ScheduledJob): void {
    const now = Date.now();
    const newRunsToday = job.runsToday + 1;

    if (job.isRecurring && job.intervalMinutes && newRunsToday < job.maxDailyRuns) {
      const nextRun = now + job.intervalMinutes * 60 * 1000;
      this.db.prepare(
        'UPDATE scheduled_jobs SET last_run_at = ?, runs_today = ?, next_run_at = ? WHERE id = ?'
      ).run(now, newRunsToday, nextRun, job.id);
    } else {
      // Completed one-off or hit daily cap
      this.db.prepare(
        'UPDATE scheduled_jobs SET last_run_at = ?, runs_today = ?, enabled = ? WHERE id = ?'
      ).run(now, newRunsToday, job.isRecurring ? 1 : 0, job.id);
    }
  }

  public resetDailyCounters(): void {
    this.db.prepare('UPDATE scheduled_jobs SET runs_today = 0').run();
  }

  public close(): void {
    this.db.close();
  }
}

export function createSchedulerServer(service?: SchedulerService): McpServer {
  const sched = service || new SchedulerService();
  const server = new McpServer({
    name: 'hyposea-scheduler',
    version: '1.0.0'
  });

  server.tool(
    'schedule_task',
    'Schedule a reminder or recurring proactive task (minimum interval: 15 minutes, maximum 10 runs/day)',
    {
      task: z.string().describe('Prompt or task instruction to execute when due'),
      delay_minutes: z.number().optional().describe('Minutes from now before the first run (default 5)'),
      interval_minutes: z.number().optional().describe('Interval between recurring runs in minutes (>= 15)'),
      is_recurring: z.boolean().optional().describe('Whether this task repeats periodically')
    },
    async ({ task, delay_minutes, interval_minutes, is_recurring }) => {
      const res = sched.scheduleTask({
        task,
        delayMinutes: delay_minutes,
        intervalMinutes: interval_minutes,
        isRecurring: is_recurring
      });
      return {
        content: [{ type: 'text', text: res.message }]
      };
    }
  );

  server.tool(
    'list_jobs',
    'List all active reminders and recurring scheduled jobs',
    {},
    async () => {
      const jobs = sched.listJobs();
      if (jobs.length === 0) {
        return {
          content: [{ type: 'text', text: 'No active scheduled tasks or reminders.' }]
        };
      }

      const text = jobs
        .map(
          (j) =>
            `• **[${j.id}]** ${j.task} — Next run: ${new Date(j.nextRunAt).toLocaleString()} ` +
            `(${j.isRecurring ? `Recurring every ${j.intervalMinutes}m` : 'One-time'}) [${j.runsToday}/${j.maxDailyRuns} runs today]`
        )
        .join('\n');

      return {
        content: [{ type: 'text', text }]
      };
    }
  );

  server.tool(
    'cancel_job',
    'Cancel or disable a scheduled task by ID',
    {
      job_id: z.string().describe('The ID of the job to cancel (e.g. job_a1b2c3d4)')
    },
    async ({ job_id }) => {
      const ok = sched.cancelJob(job_id);
      return {
        content: [{ type: 'text', text: ok ? `Job ${job_id} cancelled.` : `Job ${job_id} not found.` }]
      };
    }
  );

  return server;
}

export async function startSchedulerServerStdio(): Promise<void> {
  const server = createSchedulerServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
