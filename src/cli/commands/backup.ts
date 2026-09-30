import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { getHyposeaPaths, ensureHyposeaDirs } from '../../config/paths.js';

export function runBackup(outputPath?: string, baseDir?: string): string {
  const paths = getHyposeaPaths(baseDir);
  if (!fs.existsSync(paths.home)) {
    throw new Error(`Hyposea directory not found at ${paths.home}`);
  }

  const dest = outputPath || path.resolve(path.dirname(paths.home), `hyposea-backup-${Date.now()}.tar.gz`);
  execSync(`tar --exclude="*.tar.gz" -czf "${dest}" -C "${path.dirname(paths.home)}" "${path.basename(paths.home)}"`, {
    stdio: 'inherit'
  });

  console.log(`📦 Backup archive successfully created at: ${dest}`);
  return dest;
}

export function runRestore(archivePath: string, destDir?: string): void {
  const resolved = path.resolve(archivePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Backup archive file not found: ${resolved}`);
  }

  const paths = getHyposeaPaths(destDir);
  ensureHyposeaDirs(paths);

  execSync(`tar -xzf "${resolved}" -C "${paths.home}" --strip-components=1`, {
    stdio: 'inherit'
  });

  // Re-enforce secrets permissions
  if (fs.existsSync(paths.secretsFile)) {
    fs.chmodSync(paths.secretsFile, 0o600);
  }

  console.log(`✅ Hyposea state successfully restored to: ${paths.home}`);
}
