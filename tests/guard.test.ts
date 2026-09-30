import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GuardModule, isDeletionIntent, hasExplicitConfirmationFlag } from '../src/modules/guard/index.js';

describe('GuardModule & Safety Policies', () => {
  test('flags directory traversal attempts outside allowed boundary', () => {
    const guard = new GuardModule({ allowedDirectories: ['/home/ubuntu/moondust-project/hyposea-agent'] });

    const safeCheck = guard.evaluate('cat /home/ubuntu/moondust-project/hyposea-agent/package.json');
    assert.strictEqual(safeCheck.isDangerous, false);

    const outsideCheck = guard.evaluate('cat /etc/passwd');
    assert.strictEqual(outsideCheck.isDangerous, true);
    assert.strictEqual(outsideCheck.requiresConfirmation, true);
    assert.ok(outsideCheck.reason?.includes('outside allowed'));
  });

  test('detects deletion keywords and respects bypass flags', () => {
    const guard = new GuardModule();

    const normalDel = guard.evaluate('rm -rf temp_dir');
    assert.strictEqual(normalDel.isDangerous, true);
    assert.strictEqual(normalDel.requiresConfirmation, true);
    assert.strictEqual(normalDel.isBypassed, false);

    const forceDel = guard.evaluate('rm -rf temp_dir --force');
    assert.strictEqual(forceDel.isDangerous, true);
    assert.strictEqual(forceDel.requiresConfirmation, false, 'Should not require confirmation when force flag provided');
    assert.strictEqual(forceDel.isBypassed, true);
  });

  test('preserves parity for helper functions', () => {
    assert.strictEqual(isDeletionIntent('delete this file'), true);
    assert.strictEqual(isDeletionIntent('show git log'), false);
    assert.strictEqual(hasExplicitConfirmationFlag('del old.log -y'), true);
    assert.strictEqual(hasExplicitConfirmationFlag('del old.log'), false);
  });
});
