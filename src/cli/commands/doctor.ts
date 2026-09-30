import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { AgyRunner } from '../../runners/agy.js';
import { getHyposeaPaths } from '../../config/paths.js';
import { loadHyposeaConfig } from '../../config/load.js';

export interface DoctorCheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export async function runDoctorChecks(baseDir?: string): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];
  const paths = getHyposeaPaths(baseDir);
  const config = loadHyposeaConfig(baseDir);

  // 1. Node.js Version Check
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor >= 20) {
    results.push({
      name: 'Node.js Version',
      status: 'pass',
      message: `Node v${process.versions.node} (>= v20 required)`
    });
  } else {
    results.push({
      name: 'Node.js Version',
      status: 'fail',
      message: `Node v${process.versions.node} is below recommended v20`
    });
  }

  // 2. AGY Binary Check
  let agyFound = false;
  try {
    const agyVersion = execSync(`"${config.agyBinPath}" --version`, { encoding: 'utf8' }).trim();
    results.push({
      name: 'AGY Binary',
      status: 'pass',
      message: `Found at ${config.agyBinPath} (${agyVersion})`
    });
    agyFound = true;
  } catch (err: any) {
    results.push({
      name: 'AGY Binary',
      status: 'fail',
      message: `Failed to execute ${config.agyBinPath}: ${err.message}`
    });
  }

  // 3. AGY Authentication & Probe Check
  if (agyFound) {
    try {
      const runner = new AgyRunner({ binPath: config.agyBinPath, defaultCwd: config.workDir });
      const probe = await runner.probe();
      if (probe.status === 'ok') {
        results.push({
          name: 'AGY Probe & Authentication',
          status: 'pass',
          message: probe.reason || 'AGY is authenticated and operational'
        });
      } else if (probe.status === 'not_logged_in') {
        results.push({
          name: 'AGY Probe & Authentication',
          status: 'fail',
          message: 'AGY requires interactive login on the host server. Run "agy" interactively.'
        });
      } else {
        results.push({
          name: 'AGY Probe & Authentication',
          status: 'warn',
          message: probe.reason || 'AGY status returned unknown'
        });
      }
    } catch (probeErr: any) {
      results.push({
        name: 'AGY Probe & Authentication',
        status: 'fail',
        message: probeErr.message
      });
    }
  }

  // 4. Discord Bot Token Check
  if (config.discordToken && config.discordToken.length > 20) {
    results.push({
      name: 'Discord Token',
      status: 'pass',
      message: 'Token configured and present'
    });
  } else {
    results.push({
      name: 'Discord Token',
      status: 'fail',
      message: 'DISCORD_BOT_TOKEN is missing or empty'
    });
  }

  // 5. Authorized Users Allowlist Check
  if (config.mainframeAuthorizedUsers.length > 0) {
    results.push({
      name: 'Owner Allowlist',
      status: 'pass',
      message: `${config.mainframeAuthorizedUsers.length} authorized user ID(s) configured`
    });
  } else {
    results.push({
      name: 'Owner Allowlist',
      status: 'fail',
      message: 'MAINFRAME_AUTHORIZED_USERS is empty. Nobody can trigger commands.'
    });
  }

  // 6. Data Directory & Secrets Permissions
  try {
    if (fs.existsSync(paths.home)) {
      results.push({
        name: 'Data Directory',
        status: 'pass',
        message: `Writable at ${paths.home}`
      });
    } else {
      results.push({
        name: 'Data Directory',
        status: 'warn',
        message: `Directory ${paths.home} does not exist yet (run setup)`
      });
    }

    if (fs.existsSync(paths.secretsFile)) {
      const stats = fs.statSync(paths.secretsFile);
      const mode = (stats.mode & 0o777).toString(8);
      if (mode === '600' || mode === '400') {
        results.push({
          name: 'Secrets Permissions',
          status: 'pass',
          message: `${paths.secretsFile} permissions are secure (0${mode})`
        });
      } else {
        results.push({
          name: 'Secrets Permissions',
          status: 'warn',
          message: `${paths.secretsFile} permissions are 0${mode} (recommended: 0600)`
        });
      }
    }
  } catch (err: any) {
    results.push({
      name: 'File Permissions',
      status: 'fail',
      message: err.message
    });
  }

  // 7. Systemd Service State Check
  try {
    const serviceStatus = execSync('systemctl --user is-active hyposea.service 2>/dev/null || true', {
      encoding: 'utf8'
    }).trim();
    if (serviceStatus === 'active') {
      results.push({
        name: 'Systemd Service',
        status: 'pass',
        message: 'hyposea.service is active (running)'
      });
    } else if (serviceStatus) {
      results.push({
        name: 'Systemd Service',
        status: 'warn',
        message: `hyposea.service is ${serviceStatus}`
      });
    } else {
      results.push({
        name: 'Systemd Service',
        status: 'warn',
        message: 'hyposea.service not found or not enabled yet'
      });
    }
  } catch {
    results.push({
      name: 'Systemd Service',
      status: 'warn',
      message: 'Systemd user daemon is not available'
    });
  }

  return results;
}

export async function printDoctorReport(baseDir?: string): Promise<boolean> {
  console.log('\n🩺 Running Hyposea Health & Diagnostics Doctor...\n');
  const results = await runDoctorChecks(baseDir);

  let hasFail = false;
  for (const r of results) {
    const symbol = r.status === 'pass' ? '✅' : r.status === 'warn' ? '⚠️' : '❌';
    console.log(`${symbol} **${r.name}:** ${r.message}`);
    if (r.status === 'fail') hasFail = true;
  }

  console.log('');
  if (hasFail) {
    console.log('❌ Doctor detected critical issues. Review and resolve the failures above.');
    return false;
  }

  console.log('🎉 All essential checks passed! Hyposea is healthy and ready.\n');
  return true;
}
