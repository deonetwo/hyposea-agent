import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Pipeline } from '../src/core/pipeline.js';
import { Channel, InboundMessage, OutboundMessage, ChannelRef } from '../src/channels/channel.js';
import { AgentRunner } from '../src/runners/runner.js';
import { SessionStore } from '../src/core/session-store.js';
import { PerKeyQueue } from '../src/core/queue.js';
import { AppConfig } from '../src/config.js';
import { ProbeResult, RunRequest, RunResult } from '../src/core/types.js';

class MockChannel implements Channel {
  public readonly name = 'mock';
  public sent: { target: ChannelRef; out: OutboundMessage }[] = [];
  private emitFn?: (msg: InboundMessage) => Promise<void> | void;

  async start(emit: (msg: InboundMessage) => Promise<void> | void): Promise<void> {
    this.emitFn = emit;
  }

  async send(target: ChannelRef, out: OutboundMessage): Promise<void> {
    this.sent.push({ target, out });
  }

  async stop(): Promise<void> {}

  async trigger(msg: InboundMessage) {
    if (this.emitFn) await this.emitFn(msg);
  }
}

class MockRunner implements AgentRunner {
  public runs: RunRequest[] = [];

  async run(req: RunRequest): Promise<RunResult> {
    this.runs.push(req);
    return {
      response: `Echo: ${req.prompt}`,
      conversationId: 'mock-conv-42',
      tokensUsed: 12
    };
  }

  async probe(): Promise<ProbeResult> {
    return { status: 'ok', reason: 'mock ready' };
  }
}

describe('Pipeline End-to-End', () => {
  const config: AppConfig = {
    discordToken: 'mock-bot-token-1234567890',
    mainframeEnabled: true,
    mainframeChannel: 'mainframe-channel',
    mainframeAuthorizedUsers: ['owner-1'],
    mainframePrefix: '!agy',
    agyBinPath: '/usr/bin/agy',
    allowedGuildIds: [],
    workDir: process.cwd(),
    dbPath: ':memory:',
    skipPermissions: false
  };

  test('executes prompt through full pipeline and records audit log', async () => {
    const channel = new MockChannel();
    const runner = new MockRunner();
    const store = new SessionStore({ inMemory: true });
    const queue = new PerKeyQueue();

    const pipeline = new Pipeline({
      channel,
      runner,
      store,
      queue,
      config
    });

    await pipeline.start();

    const msg: InboundMessage = {
      id: 'm1',
      channelId: 'thread-99',
      authorId: 'owner-1',
      authorName: 'Owner',
      content: 'hello world',
      isDm: false,
      isThread: true,
      createdAt: Date.now()
    };

    await channel.trigger(msg);

    // Verify runner executed
    assert.strictEqual(runner.runs.length, 1);
    assert.ok(runner.runs[0].prompt.includes('hello world'));

    // Verify session stored
    const session = store.get('thread-99');
    assert.ok(session);
    assert.strictEqual(session.conversationId, 'mock-conv-42');

    // Verify response sent via channel
    assert.ok(channel.sent.length >= 1);
    assert.ok(channel.sent[0].out.content.includes('Echo:'));

    // Verify audit log captured
    const logs = pipeline.getAuditModule().getRecentLogs(5);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].authorId, 'owner-1');
    assert.strictEqual(logs[0].status, 'success');
  });

  test('handles built-in status and reset commands without invoking runner', async () => {
    const channel = new MockChannel();
    const runner = new MockRunner();
    const store = new SessionStore({ inMemory: true });
    const queue = new PerKeyQueue();

    const pipeline = new Pipeline({
      channel,
      runner,
      store,
      queue,
      config
    });

    await pipeline.start();

    // Trigger status command
    await channel.trigger({
      id: 'm2',
      channelId: 'thread-99',
      authorId: 'owner-1',
      authorName: 'Owner',
      content: 'status',
      isDm: false,
      isThread: true,
      createdAt: Date.now()
    });

    assert.strictEqual(runner.runs.length, 0, 'Status command must not invoke AGY');
    assert.ok(channel.sent.some((s) => s.out.content.includes('Mainframe Status')));

    // Trigger reset command
    await channel.trigger({
      id: 'm3',
      channelId: 'thread-99',
      authorId: 'owner-1',
      authorName: 'Owner',
      content: 'reset',
      isDm: false,
      isThread: true,
      createdAt: Date.now()
    });

    assert.strictEqual(runner.runs.length, 0, 'Reset command must not invoke AGY');
    assert.ok(channel.sent.some((s) => s.out.content.includes('Session Reset')));
  });
});
