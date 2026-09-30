import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AgyRunner } from '../src/runners/agy.js';

describe('AgyRunner', () => {
  test('probe() detects AGY availability and authentication', async () => {
    const runner = new AgyRunner();
    const probe = await runner.probe();
    assert.strictEqual(probe.status, 'ok', `Probe should succeed, got ${probe.status}: ${probe.reason}`);
  });

  test('aborts execution when signal is already aborted or aborted mid-run', async () => {
    const runner = new AgyRunner();
    const controller = new AbortController();
    controller.abort();

    const result = await runner.run({
      prompt: 'ping',
      signal: controller.signal
    });

    assert.strictEqual(result.aborted, true);
    assert.ok(result.error?.includes('aborted'));
  });

  test('fetchQuota() retrieves quota information without errors', async () => {
    const runner = new AgyRunner();
    const quota = await runner.fetchQuota();
    assert.strictEqual(quota.success, true);
    assert.ok(quota.data || quota.rawText);
  });
});
