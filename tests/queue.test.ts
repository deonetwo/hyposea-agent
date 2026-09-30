import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PerKeyQueue } from '../src/core/queue.js';

describe('PerKeyQueue', () => {
  test('serializes tasks for the same key strictly in FIFO order', async () => {
    const queue = new PerKeyQueue();
    const order: number[] = [];

    const p1 = queue.enqueue('thread-1', async () => {
      await new Promise((r) => setTimeout(r, 40));
      order.push(1);
      return 1;
    });

    const p2 = queue.enqueue('thread-1', async () => {
      order.push(2);
      return 2;
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(r1, 1);
    assert.strictEqual(r2, 2);
    assert.deepStrictEqual(order, [1, 2]);
  });

  test('different keys execute independently and concurrently', async () => {
    const queue = new PerKeyQueue();
    let thread2FinishedFirst = false;

    const p1 = queue.enqueue('thread-1', async () => {
      await new Promise((r) => setTimeout(r, 60));
      return 't1';
    });

    const p2 = queue.enqueue('thread-2', async () => {
      await new Promise((r) => setTimeout(r, 10));
      thread2FinishedFirst = true;
      return 't2';
    });

    await Promise.all([p1, p2]);
    assert.strictEqual(thread2FinishedFirst, true);
  });

  test('aborts the running task when abort(key) is invoked', async () => {
    const queue = new PerKeyQueue();
    let aborted = false;

    const p = queue.enqueue('thread-1', async (signal) => {
      return new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          resolve('aborted-gracefully');
        });
      });
    });

    assert.strictEqual(queue.isBusy('thread-1'), true);
    const didAbort = queue.abort('thread-1');
    assert.strictEqual(didAbort, true);

    const result = await p;
    assert.strictEqual(result, 'aborted-gracefully');
    assert.strictEqual(aborted, true);
    assert.strictEqual(queue.isBusy('thread-1'), false);
  });
});
