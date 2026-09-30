import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export interface HyposeaPaths {
  home: string;
  configFile: string;
  secretsFile: string;
  dbDir: string;
  dbFile: string;
  memoryDir: string;
  skillsDir: string;
  logsDir: string;
}

export function getHyposeaHome(): string {
  if (process.env.HYPOSEA_HOME) {
    return path.resolve(process.env.HYPOSEA_HOME);
  }
  return path.join(os.homedir(), '.hyposea');
}

export function getHyposeaPaths(baseDir?: string): HyposeaPaths {
  const home = baseDir ? path.resolve(baseDir) : getHyposeaHome();
  const dbDir = path.join(home, 'db');
  return {
    home,
    configFile: path.join(home, 'config.yaml'),
    secretsFile: path.join(home, 'secrets.env'),
    dbDir,
    dbFile: path.join(dbDir, 'hyposea.db'),
    memoryDir: path.join(home, 'memory'),
    skillsDir: path.join(home, 'skills'),
    logsDir: path.join(home, 'logs')
  };
}

export function ensureHyposeaDirs(paths: HyposeaPaths): void {
  const dirs = [paths.home, paths.dbDir, paths.memoryDir, paths.skillsDir, paths.logsDir];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}
