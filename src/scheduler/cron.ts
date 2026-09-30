import { EventBus } from '../core/events.js';
import { SchedulerService } from '../mcp/scheduler-server/index.js';
import { NotifyService } from '../mcp/notify-server/index.js';
import { Channel } from '../channels/channel.js';

export interface CronSchedulerOptions {
  bus: EventBus;
  schedulerService?: SchedulerService;
  notifyService?: NotifyService;
  channel?: Channel;
  pollIntervalMs?: number;
  ownerId?: string;
}

export class CronScheduler {
  private bus: EventBus;
  private schedulerService: SchedulerService;
  private notifyService: NotifyService;
  private channel?: Channel;
  private pollIntervalMs: number;
  private ownerId?: string;
  private timer: NodeJS.Timeout | null = null;
  private lastResetDay: number;

  constructor(options: CronSchedulerOptions) {
    this.bus = options.bus;
    this.schedulerService = options.schedulerService || new SchedulerService();
    this.notifyService = options.notifyService || new NotifyService();
    this.channel = options.channel;
    this.pollIntervalMs = options.pollIntervalMs || 30000; // 30s poll
    this.ownerId = options.ownerId;
    this.lastResetDay = new Date().getUTCDate();
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[CronScheduler] Error during tick:', err.message);
      });
    }, this.pollIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async tick(): Promise<void> {
    const currentDay = new Date().getUTCDate();
    if (currentDay !== this.lastResetDay) {
      this.schedulerService.resetDailyCounters();
      this.lastResetDay = currentDay;
    }

    // 1. Check due scheduled jobs and emit job.due events
    const dueJobs = this.schedulerService.getDueJobs();
    for (const job of dueJobs) {
      this.schedulerService.markJobExecuted(job);
      await this.bus.emit('job.due', {
        jobId: job.id,
        task: job.task,
        target: {
          channelId: job.targetChannelId || `dm-${this.ownerId || 'default'}`
        },
        metadata: {
          isRecurring: job.isRecurring,
          intervalMinutes: job.intervalMinutes
        }
      });
    }

    // 2. Deliver pending proactive notifications from outbox if channel is attached
    if (this.channel) {
      const pendingNotices = this.notifyService.getPendingNotifications();
      for (const notice of pendingNotices) {
        try {
          const targetId = notice.targetChannelId || `dm-${this.ownerId || 'default'}`;
          await this.channel.send({ channelId: targetId }, { content: notice.message });
          this.notifyService.markNotificationSent(notice.id);
        } catch (err: any) {
          console.error(`[CronScheduler] Failed to deliver notification #${notice.id}:`, err.message);
          this.notifyService.markNotificationFailed(notice.id);
        }
      }
    }
  }
}
