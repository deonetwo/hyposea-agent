import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Channel, InboundMessage, OutboundMessage, ChannelRef } from '../src/channels/channel.js';

describe('Channel Interface & Inbound Routing', () => {
  // Mock channel implementation to test contract
  class MockChannel implements Channel {
    public readonly name = 'mock';
    public emitted: InboundMessage[] = [];
    public sent: { target: ChannelRef; out: OutboundMessage }[] = [];
    private emitFn?: (msg: InboundMessage) => Promise<void> | void;

    async start(emit: (msg: InboundMessage) => Promise<void> | void): Promise<void> {
      this.emitFn = emit;
    }

    async send(target: ChannelRef, out: OutboundMessage): Promise<void> {
      this.sent.push({ target, out });
    }

    async stop(): Promise<void> {}

    async simulateInbound(msg: InboundMessage) {
      if (this.emitFn) {
        await this.emitFn(msg);
      }
    }
  }

  test('MockChannel conforms to Channel interface', async () => {
    const mock = new MockChannel();
    await mock.start((msg) => {
      mock.emitted.push(msg);
    });

    const sampleInbound: InboundMessage = {
      id: 'm1',
      channelId: 'dm-channel-1',
      authorId: 'user-owner',
      authorName: 'owner',
      content: 'hello from dm',
      isDm: true,
      isThread: false,
      createdAt: Date.now()
    };

    await mock.simulateInbound(sampleInbound);
    assert.strictEqual(mock.emitted.length, 1);
    assert.strictEqual(mock.emitted[0].isDm, true);
    assert.strictEqual(mock.emitted[0].authorId, 'user-owner');

    await mock.send({ channelId: 'dm-channel-1' }, { content: 'hello back' });
    assert.strictEqual(mock.sent.length, 1);
    assert.strictEqual(mock.sent[0].out.content, 'hello back');
  });

  test('DM session keys are isolated per user', () => {
    const getSessionKey = (msg: InboundMessage) =>
      msg.isDm ? `dm-${msg.authorId}` : msg.isThread ? msg.channelId : `main-${msg.channelId}`;

    const dmMsg1: InboundMessage = {
      id: '1',
      channelId: 'dm1',
      authorId: 'owner-id',
      authorName: 'owner',
      content: 'status',
      isDm: true,
      isThread: false,
      createdAt: Date.now()
    };

    const threadMsg: InboundMessage = {
      id: '2',
      channelId: 'thread-999',
      authorId: 'owner-id',
      authorName: 'owner',
      content: 'task',
      isDm: false,
      isThread: true,
      createdAt: Date.now()
    };

    const mainMsg: InboundMessage = {
      id: '3',
      channelId: 'main-chan-100',
      authorId: 'owner-id',
      authorName: 'owner',
      content: 'hello',
      isDm: false,
      isThread: false,
      createdAt: Date.now()
    };

    assert.strictEqual(getSessionKey(dmMsg1), 'dm-owner-id');
    assert.strictEqual(getSessionKey(threadMsg), 'thread-999');
    assert.strictEqual(getSessionKey(mainMsg), 'main-main-chan-100');
  });
});
