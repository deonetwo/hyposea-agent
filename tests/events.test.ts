import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EventBus } from '../src/core/events.js';

describe('EventBus', () => {
  test('dispatches typed events to subscribers', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    const unbind = bus.on('run.aborted', (data) => {
      received.push(data.sessionKey);
    });

    await bus.emit('run.aborted', {
      message: {
        id: '1',
        channelId: 'c1',
        authorId: 'u1',
        authorName: 'user',
        content: 'stop',
        isDm: false,
        isThread: false,
        createdAt: Date.now()
      },
      sessionKey: 'sess-123',
      reason: 'test abort'
    });

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0], 'sess-123');

    // Test unbinding
    unbind();
    await bus.emit('run.aborted', {
      message: {
        id: '2',
        channelId: 'c1',
        authorId: 'u1',
        authorName: 'user',
        content: 'stop',
        isDm: false,
        isThread: false,
        createdAt: Date.now()
      },
      sessionKey: 'sess-456'
    });
    assert.strictEqual(received.length, 1, 'Should not receive event after unbinding');
  });
});
