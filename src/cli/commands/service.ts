import { execSync, spawn } from 'node:child_process';

export function serviceStart(): void {
  try {
    execSync('systemctl --user start hyposea.service', { stdio: 'inherit' });
    console.log('✅ Started hyposea.service');
  } catch (err: any) {
    console.error('❌ Failed to start service:', err.message);
  }
}

export function serviceStop(): void {
  try {
    execSync('systemctl --user stop hyposea.service', { stdio: 'inherit' });
    console.log('🛑 Stopped hyposea.service');
  } catch (err: any) {
    console.error('❌ Failed to stop service:', err.message);
  }
}

export function serviceRestart(): void {
  try {
    execSync('systemctl --user restart hyposea.service', { stdio: 'inherit' });
    console.log('🔄 Restarted hyposea.service');
  } catch (err: any) {
    console.error('❌ Failed to restart service:', err.message);
  }
}

export function serviceStatus(): void {
  try {
    execSync('systemctl --user status hyposea.service', { stdio: 'inherit' });
  } catch {
    // systemctl status exits non-zero if inactive, stdio already printed
  }
}

export function serviceLogs(lines = 50, follow = false): void {
  const args = ['--user', '-u', 'hyposea.service', '-n', String(lines)];
  if (follow) args.push('-f');

  const child = spawn('journalctl', args, { stdio: 'inherit' });
  child.on('error', (err) => console.error('Failed to view logs:', err.message));
}
