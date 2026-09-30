import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getHyposeaPaths, ensureHyposeaDirs } from '../src/config/paths.js';
import { loadHyposeaConfig } from '../src/config/load.js';
import { runDoctorChecks } from '../src/cli/commands/doctor.js';
import { runBackup, runRestore } from '../src/cli/commands/backup.js';

describe('Config & CLI Control Plane', () => {
  const tmpBase = path.resolve(process.cwd(), 'data', 'test-cli-env');

  test('generates expected directory paths and ensures creation', () => {
    const paths = getHyposeaPaths(tmpBase);
    assert.strictEqual(paths.home, tmpBase);
    assert.strictEqual(paths.configFile, path.join(tmpBase, 'config.yaml'));
    assert.strictEqual(paths.secretsFile, path.join(tmpBase, 'secrets.env'));

    ensureHyposeaDirs(paths);
    assert.strictEqual(fs.existsSync(paths.home), true);
    assert.strictEqual(fs.existsSync(paths.dbDir), true);
    assert.strictEqual(fs.existsSync(paths.memoryDir), true);
  });

  test('loads configuration from YAML and secrets.env', () => {
    const paths = getHyposeaPaths(tmpBase);
    ensureHyposeaDirs(paths);

    // Write mock YAML
    fs.writeFileSync(
      paths.configFile,
      YAML.stringify({
        channel: 'custom-assistant',
        prefix: '!custom',
        authorizedUsers: ['1122334455'],
        workDir: '/tmp'
      })
    );

    // Write mock secrets.env
    fs.writeFileSync(paths.secretsFile, 'DISCORD_BOT_TOKEN=secret_token_from_env_file_12345\n', { mode: 0o600 });

    const loaded = loadHyposeaConfig(tmpBase);
    assert.strictEqual(loaded.mainframeChannel, 'custom-assistant');
    assert.strictEqual(loaded.mainframePrefix, '!custom');
    assert.strictEqual(loaded.mainframeAuthorizedUsers.includes('1122334455'), true);
    assert.strictEqual(loaded.discordToken, 'secret_token_from_env_file_12345');
  });

  test('runDoctorChecks verifies Node, paths, and environment', async () => {
    const checks = await runDoctorChecks(tmpBase);
    assert.ok(checks.length >= 5);

    const nodeCheck = checks.find((c) => c.name === 'Node.js Version');
    assert.ok(nodeCheck);
    assert.strictEqual(nodeCheck.status, 'pass');

    const agyCheck = checks.find((c) => c.name === 'AGY Binary');
    assert.ok(agyCheck);
    assert.strictEqual(agyCheck.status, 'pass');
  });

  test('backup and restore preserves state', () => {
    const backupDest = path.join(tmpBase, '..', `test-backup-${Date.now()}.tar.gz`);
    runBackup(backupDest, tmpBase);
    assert.strictEqual(fs.existsSync(backupDest), true);

    const restoreDest = path.join(tmpBase, '..', 'restored-env');
    fs.mkdirSync(restoreDest, { recursive: true });
    runRestore(backupDest, restoreDest);

    const restoredPaths = getHyposeaPaths(restoreDest);
    assert.strictEqual(fs.existsSync(restoredPaths.configFile), true);

    // Cleanup
    fs.rmSync(tmpBase, { recursive: true, force: true });
    fs.rmSync(restoreDest, { recursive: true, force: true });
    if (fs.existsSync(backupDest)) fs.unlinkSync(backupDest);
  });
});
