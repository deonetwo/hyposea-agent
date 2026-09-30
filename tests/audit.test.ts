import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AuditModule } from '../src/modules/audit/index.js';
import { EventBus } from '../src/core/events.js';

describe('AuditModule', () => {
  test('records run events and aggregates stats', async () => {
    const audit = new AuditModule({ inMemory: true });
    const bus = new EventBus();
    audit.register(bus);

    const mockMsg = {
      id: 'm1',
      channelId: 'c1',
      authorId: 'u1',
      authorName: 'alice',
      content: 'calculate fibonacci',
      isDm: false,
      isThread: false,
      createdAt: Date.now()
    };

    // Emit run.after
    await bus.emit('run.after', {
      message: mockMsg,
      sessionKey: 'session-main',
      prompt: 'calculate fibonacci',
      result: {
        response: 'Fibonacci result',
        tokensUsed: 150,
        conversationId: 'c-1'
      },
      durationMs: 1250
    });

    const logs = audit.getRecentLogs(10);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].authorId, 'u1');
    assert.strictEqual(logs[0].authorName, 'alice');
    assert.strictEqual(logs[0].status, 'success');
    assert.strictEqual(logs[0].tokensUsed, 150);
    assert.strictEqual(logs[0].durationMs, 1250);
    assert.ok(logs[0].promptHash.length > 0);

    const stats = audit.getStats();
    assert.strictEqual(stats.totalRuns, 1);
    assert.strictEqual(stats.totalTokens, 150);
    assert.strictEqual(stats.errorCount, 0);

    audit.close();
  });
});
