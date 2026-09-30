import fs from 'node:fs';
import dotenv from 'dotenv';
import YAML from 'yaml';
import { getHyposeaPaths } from './paths.js';
import { ConfigYamlSchema, SecretsSchema } from './schema.js';
import { AppConfig } from '../config.js';

dotenv.config();

export function loadHyposeaConfig(baseDir?: string): AppConfig {
  const paths = getHyposeaPaths(baseDir);

  let yamlData: Record<string, any> = {};
  if (fs.existsSync(paths.configFile)) {
    try {
      const content = fs.readFileSync(paths.configFile, 'utf8');
      yamlData = YAML.parse(content) || {};
    } catch (err: any) {
      console.warn(`[Config] ⚠️ Warning: Failed to parse ${paths.configFile}:`, err.message);
    }
  }

  // Load secrets.env if it exists
  const secretsEnv: Record<string, string> = {};
  if (fs.existsSync(paths.secretsFile)) {
    try {
      const parsed = dotenv.parse(fs.readFileSync(paths.secretsFile, 'utf8'));
      Object.assign(secretsEnv, parsed);
    } catch (err: any) {
      console.warn(`[Config] ⚠️ Warning: Failed to read ${paths.secretsFile}:`, err.message);
    }
  }

  // Merge precedence: environment variables > secrets.env > config.yaml > defaults
  const discordToken =
    process.env.DISCORD_BOT_TOKEN?.trim() ||
    secretsEnv.DISCORD_BOT_TOKEN?.trim() ||
    secretsEnv.discordToken?.trim() ||
    '';

  const mainframeChannel =
    process.env.MAINFRAME_CHANNEL?.trim() ||
    yamlData.channel ||
    'mainframe-channel';

  const mainframePrefix =
    process.env.MAINFRAME_PREFIX?.trim() ||
    yamlData.prefix ||
    '!agy';

  const agyBinPath =
    process.env.AGY_BIN_PATH?.trim() ||
    yamlData.agyBinPath ||
    '/home/ubuntu/.local/bin/agy';

  const rawUsers =
    process.env.MAINFRAME_AUTHORIZED_USERS ||
    (Array.isArray(yamlData.authorizedUsers) ? yamlData.authorizedUsers.join(',') : '');
  const mainframeAuthorizedUsers = rawUsers
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  const rawGuilds =
    process.env.ALLOWED_GUILD_IDS ||
    process.env.DISCORD_GUILD_ID ||
    (Array.isArray(yamlData.allowedGuildIds) ? yamlData.allowedGuildIds.join(',') : '');
  const allowedGuildIds = rawGuilds
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  const workDir =
    process.env.HYPOSEA_WORKDIR?.trim() ||
    yamlData.workDir ||
    process.cwd();

  const dbPath =
    process.env.HYPOSEA_DB_PATH?.trim() ||
    paths.dbFile;

  const skipPermissions =
    process.env.AGY_SKIP_PERMISSIONS === 'true' ||
    Boolean(yamlData.skipPermissions);

  return {
    discordToken,
    mainframeEnabled: process.env.MAINFRAME_ENABLED !== 'false',
    mainframeChannel,
    mainframeAuthorizedUsers,
    mainframePrefix,
    agyBinPath,
    allowedGuildIds,
    workDir,
    dbPath,
    skipPermissions
  };
}

export function maskSecret(secret?: string): string {
  if (!secret) return '(not set)';
  if (secret.length <= 8) return '****';
  return `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`;
}
