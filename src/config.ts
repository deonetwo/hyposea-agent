import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  discordToken: string;
  mainframeEnabled: boolean;
  mainframeChannel: string;
  mainframeAuthorizedUsers: string[];
  mainframePrefix: string;
  agyBinPath: string;
  allowedGuildIds: string[];
  authToken?: string;
}

export function loadConfig(): AppConfig {
  const discordToken = process.env.DISCORD_BOT_TOKEN?.trim() || '';
  const mainframeChannel = process.env.MAINFRAME_CHANNEL?.trim() || 'mainframe-channel';
  const mainframePrefix = process.env.MAINFRAME_PREFIX?.trim() || '!agy';
  const agyBinPath = process.env.AGY_BIN_PATH?.trim() || '/home/ubuntu/.local/bin/agy';
  const mainframeEnabled = process.env.MAINFRAME_ENABLED !== 'false';
  const rawUsers = process.env.MAINFRAME_AUTHORIZED_USERS || '';
  const mainframeAuthorizedUsers = rawUsers.split(',').map(s => s.trim()).filter(Boolean);
  const rawGuilds = process.env.ALLOWED_GUILD_IDS || process.env.DISCORD_GUILD_ID || '';
  const allowedGuildIds = rawGuilds.split(',').map(s => s.trim()).filter(Boolean);
  const authToken = process.env.MCP_AUTH_TOKEN?.trim() || undefined;

  return {
    discordToken,
    mainframeEnabled,
    mainframeChannel,
    mainframeAuthorizedUsers,
    mainframePrefix,
    agyBinPath,
    allowedGuildIds,
    authToken
  };
}

export function maskSecret(secret?: string): string {
  if (!secret) return '(not set)';
  if (secret.length <= 8) return '****';
  return `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`;
}
