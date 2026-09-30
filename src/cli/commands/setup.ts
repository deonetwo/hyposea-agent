import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import YAML from 'yaml';
import { AgyRunner } from '../../runners/agy.js';
import { ensureHyposeaDirs, getHyposeaPaths } from '../../config/paths.js';
import { loadHyposeaConfig } from '../../config/load.js';
import { printDoctorReport } from './doctor.js';

export async function runSetup(options: { nonInteractive?: boolean; baseDir?: string } = {}): Promise<void> {
  const paths = getHyposeaPaths(options.baseDir);
  const currentConfig = loadHyposeaConfig(options.baseDir);

  if (!options.nonInteractive) {
    p.intro('🚀 Hyposea Personal Assistant — System Setup');
  }

  // 1. Check Node.js
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 20) {
    console.error(`\n❌ FATAL: Node.js v20+ is required (found v${process.versions.node}).`);
    process.exit(1);
  }

  // 2. Check AGY installation & Probe
  const agyBin = currentConfig.agyBinPath || '/home/ubuntu/.local/bin/agy';
  try {
    execSync(`"${agyBin}" --version`, { stdio: 'ignore' });
  } catch {
    console.error(`\n❌ FATAL: AGY binary not found or not executable at "${agyBin}".`);
    console.error('Please install Antigravity CLI and ensure it is available in your PATH or ~/.local/bin/agy.');
    process.exit(1);
  }

  const spinner = options.nonInteractive ? null : p.spinner();
  if (spinner) spinner.start('Probing AGY authentication status...');

  const runner = new AgyRunner({ binPath: agyBin });
  const probe = await runner.probe();

  if (probe.status !== 'ok') {
    if (spinner) spinner.stop('AGY probe check failed');
    console.error('\n=============================================================');
    console.error('❌ AGY AUTHENTICATION REQUIRED');
    console.error('=============================================================');
    console.error(`Reason: ${probe.reason || 'Not logged in'}\n`);
    console.error('AGY login is a manual prerequisite:');
    console.error('1. Run "agy" interactively as the user that will run the service:');
    console.error('   $ agy');
    console.error('2. Complete login in the browser/CLI terminal.');
    console.error('3. Re-run setup:');
    console.error('   $ npx hyposea setup\n');
    console.error('See docs/DEPLOY.md for detailed prerequisites.');
    console.error('=============================================================');
    process.exit(1);
  }

  if (spinner) spinner.stop('AGY is authenticated and ready ✅');

  // 3. Ensure ~/.hyposea directory tree exists
  ensureHyposeaDirs(paths);

  // 4. Collect configuration (ask only for missing values if interactive)
  let discordToken = currentConfig.discordToken;
  let mainframeChannel = currentConfig.mainframeChannel;
  let authorizedUsers = currentConfig.mainframeAuthorizedUsers;
  let workDir = currentConfig.workDir;
  let skipPermissions = currentConfig.skipPermissions;

  if (!options.nonInteractive) {
    if (!discordToken) {
      const res = await p.password({
        message: 'Enter Discord Bot Token:',
        validate: (val) => (!val || val.length < 20 ? 'Please enter a valid token.' : undefined)
      });
      if (p.isCancel(res)) process.exit(0);
      discordToken = res as string;
    }

    if (authorizedUsers.length === 0) {
      const res = await p.text({
        message: 'Enter your Discord User Snowflake ID(s) (comma-separated):',
        placeholder: 'e.g. 123456789012345678',
        validate: (val) => (!val ? 'At least one authorized user ID is required.' : undefined)
      });
      if (p.isCancel(res)) process.exit(0);
      authorizedUsers = (res as string).split(',').map((s) => s.trim()).filter(Boolean);
    }

    if (!mainframeChannel || mainframeChannel === 'mainframe-channel') {
      const res = await p.text({
        message: 'Discord channel name for assistant commands:',
        initialValue: 'mainframe-channel'
      });
      if (p.isCancel(res)) process.exit(0);
      mainframeChannel = res as string;
    }
  }

  // 5. Write config.yaml
  const yamlConfig = {
    channel: mainframeChannel,
    prefix: currentConfig.mainframePrefix || '!agy',
    authorizedUsers,
    allowedGuildIds: currentConfig.allowedGuildIds,
    agyBinPath: agyBin,
    workDir: workDir || process.cwd(),
    skipPermissions
  };
  fs.writeFileSync(paths.configFile, YAML.stringify(yamlConfig), 'utf8');

  // 6. Write secrets.env (chmod 0600)
  const secretsContent = `DISCORD_BOT_TOKEN=${discordToken}\n`;
  fs.writeFileSync(paths.secretsFile, secretsContent, { mode: 0o600, encoding: 'utf8' });
  fs.chmodSync(paths.secretsFile, 0o600);

  // 7. Install systemd user service template
  const systemdDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  if (!fs.existsSync(systemdDir)) {
    fs.mkdirSync(systemdDir, { recursive: true });
  }

  const projectDir = process.cwd();
  const serviceUnitPath = path.join(systemdDir, 'hyposea.service');
  const serviceContent = `[Unit]
Description=Hyposea Personal Assistant Daemon (AGY Harness)
After=network.target

[Service]
Type=simple
WorkingDirectory=${projectDir}
ExecStart=${process.execPath} ${path.join(projectDir, 'dist', 'index.js')}
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=HYPOSEA_HOME=${paths.home}

[Install]
WantedBy=default.target
`;

  try {
    fs.writeFileSync(serviceUnitPath, serviceContent, 'utf8');
    execSync('systemctl --user daemon-reload 2>/dev/null || true');
    execSync('systemctl --user enable hyposea.service 2>/dev/null || true');
    console.log(`\n📦 Installed systemd user unit: ${serviceUnitPath}`);
  } catch (sysErr: any) {
    console.warn(`[Warning] Could not enable systemd user unit: ${sysErr.message}`);
  }

  // 8. Run doctor checks
  await printDoctorReport(options.baseDir);

  if (!options.nonInteractive) {
    p.outro('🎉 Setup complete! Start with "hyposea start" or "systemctl --user start hyposea".');
  }
}
