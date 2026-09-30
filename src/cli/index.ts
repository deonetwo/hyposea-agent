#!/usr/bin/env node
import { Command } from 'commander';
import { printDoctorReport } from './commands/doctor.js';
import { runSetup } from './commands/setup.js';
import { serviceLogs, serviceRestart, serviceStart, serviceStatus, serviceStop } from './commands/service.js';
import { runBackup, runRestore } from './commands/backup.js';
import { runChat } from './commands/chat.js';

const program = new Command();

program
  .name('hyposea')
  .description('Personal AI assistant harness on top of Google Antigravity (AGY)')
  .version('1.0.0');

program
  .command('setup')
  .description('Run idempotent assistant setup, check AGY login, write config, and install systemd unit')
  .option('-y, --non-interactive', 'Run without interactive prompts')
  .action(async (opts) => {
    await runSetup({ nonInteractive: opts.nonInteractive });
  });

program
  .command('doctor')
  .description('Run diagnostics checks (Node, AGY probe, Discord credentials, permissions, systemd state)')
  .action(async () => {
    const ok = await printDoctorReport();
    if (!ok) process.exit(1);
  });

program
  .command('start')
  .description('Start the Hyposea systemd user service')
  .action(() => {
    serviceStart();
  });

program
  .command('stop')
  .description('Stop the Hyposea systemd user service')
  .action(() => {
    serviceStop();
  });

program
  .command('restart')
  .description('Restart the Hyposea systemd user service')
  .action(() => {
    serviceRestart();
  });

program
  .command('status')
  .description('Check the Hyposea systemd user service status')
  .action(() => {
    serviceStatus();
  });

program
  .command('logs')
  .description('View Hyposea service logs via journalctl')
  .option('-n, --lines <number>', 'Number of lines to view', '50')
  .option('-f, --follow', 'Follow log stream')
  .action((opts) => {
    serviceLogs(parseInt(opts.lines, 10), opts.follow);
  });

program
  .command('backup')
  .description('Create a tar.gz backup archive of ~/.hyposea state')
  .argument('[output]', 'Output archive path')
  .action((output) => {
    runBackup(output);
  });

program
  .command('restore')
  .description('Restore ~/.hyposea state from a backup archive')
  .argument('<archive>', 'Path to backup tar.gz archive')
  .action((archive) => {
    runRestore(archive);
  });

program
  .command('chat')
  .description('Launch interactive AGY CLI pass-through session with assistant context')
  .allowUnknownOption()
  .action((_, cmd) => {
    runChat(cmd.args);
  });

program.parse();
