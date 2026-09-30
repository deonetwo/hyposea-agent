import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { SessionStore } from '../src/core/session-store.js';

describe('SessionStore (SQLite)', () => {
  test('in-memory session store creates and retrieves session', () => {
    const store = new SessionStore({ inMemory: true });
    assert.strictEqual(store.get('session-1'), null);

    store.set('session-1', 'conv-123', { user: 'u1' });
    const session = store.get('session-1');
    assert.ok(session);
    assert.strictEqual(session.conversationId, 'conv-123');
    assert.strictEqual(session.messageCount, 1);
    assert.strictEqual(session.metadata?.user, 'u1');

    store.close();
  });

  test('updating session increments messageCount and updates timestamp', () => {
    const store = new SessionStore({ inMemory: true });
    store.set('session-1', 'conv-123');
    const first = store.get('session-1')!;

    store.set('session-1', 'conv-123-v2');
    const second = store.get('session-1')!;

    assert.strictEqual(second.conversationId, 'conv-123-v2');
    assert.strictEqual(second.messageCount, 2);
    assert.ok(second.updatedAt >= first.updatedAt);

    store.close();
  });

  test('sessions persist to disk across store restarts', () => {
    const tmpDir = path.resolve(process.cwd(), 'data', 'test-db');
    const tmpDb = path.join(tmpDir, `test-${Date.now()}.db`);

    // Instance 1 writes
    const store1 = new SessionStore({ dbPath: tmpDb });
    store1.set('thread-abc', 'conv-xyz', { persistent: true });
    store1.close();

    // Instance 2 reads from same file
    const store2 = new SessionStore({ dbPath: tmpDb });
    const session = store2.get('thread-abc');
    assert.ok(session);
    assert.strictEqual(session.conversationId, 'conv-xyz');
    assert.strictEqual(session.metadata?.persistent, true);

    store2.delete('thread-abc');
    assert.strictEqual(store2.get('thread-abc'), null);
    store2.close();

    // Cleanup
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });
});
