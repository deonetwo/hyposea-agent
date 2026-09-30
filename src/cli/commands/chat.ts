import { spawn } from 'node:child_process';
import { loadHyposeaConfig } from '../../config/load.js';

export function runChat(args: string[] = []): void {
  const config = loadHyposeaConfig();
  const agyBin = config.agyBinPath || '/home/ubuntu/.local/bin/agy';

  const childArgs = ['--add-dir', config.workDir, ...args];
  if (config.skipPermissions) {
    childArgs.unshift('--dangerously-skip-permissions');
  }

  // Pass-through execution directly connected to user's TTY
  const child = spawn(agyBin, childArgs, {
    cwd: config.workDir,
    stdio: 'inherit'
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
