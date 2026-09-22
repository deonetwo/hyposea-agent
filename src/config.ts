import crypto from 'node:crypto';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export interface AppConfig {
  discordToken: string;
  defaultGuildId?: string;
  allowedGuildIds: string[];
  port: number;
  host: string;
  authToken: string;
  requireConfirmation: boolean;
  maxMessageHistory: number;
  mockMode?: boolean;
  transport?: string;
  mainframeEnabled?: boolean;
  mainframeChannel?: string;
  mainframeAuthorizedUsers?: string[];
  mainframePrefix?: string;
  agyBinPath?: string;
}

function parseAllowedGuilds(raw?: string, defaultGuild?: string): string[] {
  const set = new Set<string>();
  if (defaultGuild && defaultGuild.trim()) {
    set.add(defaultGuild.trim());
  }
  if (raw && raw.trim()) {
    raw.split(',').map(s => s.trim()).filter(Boolean).forEach(id => set.add(id));
  }
  return Array.from(set);
}

export function loadConfig(): AppConfig {
  const discordToken = process.env.DISCORD_BOT_TOKEN?.trim() || '';
  const authToken = process.env.MCP_AUTH_TOKEN?.trim() || '';
  const defaultGuildId = process.env.DISCORD_GUILD_ID?.trim() || undefined;
  const allowedGuildIds = parseAllowedGuilds(process.env.ALLOWED_GUILD_IDS, defaultGuildId);

  const port = parseInt(process.env.MCP_PORT || '3000', 10);
  const host = process.env.MCP_HOST || '0.0.0.0';

  const requireConfirmation = process.env.REQUIRE_CONFIRMATION !== 'false';
  const maxMessageHistory = Math.min(Math.max(parseInt(process.env.MAX_MESSAGE_HISTORY || '100', 10), 1), 100);

  const mainframeChannel = process.env.MAINFRAME_CHANNEL?.trim() || 'mainframe-channel';
  const mainframePrefix = process.env.MAINFRAME_PREFIX?.trim() || '!agy';
  const agyBinPath = process.env.AGY_BIN_PATH?.trim() || '/home/ubuntu/.local/bin/agy';
  const mainframeEnabled = process.env.MAINFRAME_ENABLED !== 'false';
  const rawUsers = process.env.MAINFRAME_AUTHORIZED_USERS || '515099684893622277';
  const mainframeAuthorizedUsers = rawUsers.split(',').map(s => s.trim()).filter(Boolean);

  return {
    discordToken,
    defaultGuildId,
    allowedGuildIds,
    port,
    host,
    authToken,
    requireConfirmation,
    maxMessageHistory,
    mockMode: process.argv.includes('--mock') || process.env.MOCK_MODE === 'true',
    transport: 'sse',
    mainframeEnabled,
    mainframeChannel,
    mainframeAuthorizedUsers,
    mainframePrefix,
    agyBinPath
  };
}

export function maskSecret(secret?: string): string {
  if (!secret) return '(not set)';
  if (secret.length <= 8) return '****';
  return `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`;
}

/**
 * Constant-time comparison between a user-supplied token and the configured secret.
 * Mitigates timing side-channel attacks.
 */
export function timingSafeCompare(suppliedToken?: string, expectedSecret?: string): boolean {
  if (!suppliedToken || !expectedSecret) return false;
  
  const suppliedBuffer = Buffer.from(suppliedToken);
  const expectedBuffer = Buffer.from(expectedSecret);

  if (suppliedBuffer.length !== expectedBuffer.length) {
    // Constant-time execution even when lengths differ
    crypto.timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }

  return crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}
