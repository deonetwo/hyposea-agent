import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryService } from '../src/mcp/memory-server/index.js';
import { SchedulerService } from '../src/mcp/scheduler-server/index.js';
import { NotifyService } from '../src/mcp/notify-server/index.js';
import { CronScheduler } from '../src/scheduler/cron.js';
import { EventBus } from '../src/core/events.js';
import { Channel, ChannelRef, InboundMessage, OutboundMessage } from '../src/channels/channel.js';

describe('Phase 5: Memory, Scheduler, and Notify Services', () => {
  const tmpBase = path.resolve(process.cwd(), 'data', 'test-phase5');

  test('MemoryService stores, prunes, and searches FTS5 turns', () => {
    const mem = new MemoryService(tmpBase);

    // 1. Remember facts and preferences
    const res1 = mem.remember('fact', 'User timezone is UTC+7');
    assert.strictEqual(res1.success, true);

    const res2 = mem.remember('preference', 'Prefers concise bullet points in responses');
    assert.strictEqual(res2.success, true);

    const context = mem.getContext();
    assert.ok(context.includes('UTC+7'));
    assert.ok(context.includes('concise bullet points'));

    // 2. Forget
    const forgetRes = mem.forget('timezone');
    assert.strictEqual(forgetRes.success, true);
    assert.strictEqual(forgetRes.removedCount, 1);
    assert.ok(!mem.getContext().includes('UTC+7'));

    // 3. FTS5 Conversation Indexing & Search
    mem.recordTurn('sess-100', 'user', 'What is the current architecture of hyposea?');
    mem.recordTurn('sess-100', 'assistant', 'Hyposea is a modular personal assistant harness on top of AGY.');

    const ftsMatches = mem.searchSessions('architecture');
    assert.ok(ftsMatches.length >= 1);
    assert.strictEqual(ftsMatches[0].sessionId, 'sess-100');

    mem.close();
  });

  test('SchedulerService enforces quota guards and manages jobs', () => {
    const sched = new SchedulerService(tmpBase);

    // Guard: Recurring interval < 15m must be rejected
    const invalidRes = sched.scheduleTask({
      task: 'quick ping',
      isRecurring: true,
      intervalMinutes: 5
    });
    assert.strictEqual(invalidRes.success, false);
    assert.ok(invalidRes.message.includes('Minimum recurring interval is 15 minutes'));

    // Valid job schedule
    const validRes = sched.scheduleTask({
      task: 'daily morning briefing',
      delayMinutes: 0, // due immediately
      isRecurring: true,
      intervalMinutes: 60
    });
    assert.strictEqual(validRes.success, true);
    assert.ok(validRes.job);

    const due = sched.getDueJobs();
    assert.ok(due.length >= 1);
    assert.strictEqual(due[0].task, 'daily morning briefing');

    // Cancel job
    const cancelled = sched.cancelJob(validRes.job.id);
    assert.strictEqual(cancelled, true);

    const remaining = sched.listJobs();
    assert.strictEqual(remaining.length, 0);

    sched.close();
  });

  test('NotifyService and CronScheduler deliver proactive outbox notifications', async () => {
    const bus = new EventBus();
    const notify = new NotifyService(tmpBase);
    const sched = new SchedulerService(tmpBase);

    class TestChannel implements Channel {
      name = 'test';
      sent: string[] = [];
      async start() {}
      async stop() {}
      async send(t: ChannelRef, out: OutboundMessage) {
        this.sent.push(out.content);
      }
    }

    const testChannel = new TestChannel();

    // Enqueue proactive message
    notify.enqueueMessage('Hello owner! Proactive reminder.', 'dm-owner-1');

    const cron = new CronScheduler({
      bus,
      schedulerService: sched,
      notifyService: notify,
      channel: testChannel,
      ownerId: 'owner-1'
    });

    // Run tick
    await cron.tick();

    assert.strictEqual(testChannel.sent.length, 1);
    assert.strictEqual(testChannel.sent[0], 'Hello owner! Proactive reminder.');

    // Outbox should now have 0 pending
    const pending = notify.getPendingNotifications();
    assert.strictEqual(pending.length, 0);

    notify.close();
    sched.close();

    // Cleanup tmpBase
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });
});
