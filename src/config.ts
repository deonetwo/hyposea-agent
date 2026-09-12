import dotenv from 'dotenv';
import path from 'path';

// Load .env file from current working directory or moon-link root
dotenv.config();

export interface AppConfig {
  discordToken: string;
  defaultGuildId?: string;
  allowedGuildIds: string[];
  transport: 'stdio' | 'sse';
  port: number;
  host: string;
  authToken?: string;
  requireConfirmation: boolean;
  maxMessageHistory: number;
  mockMode: boolean;
  clientId: string;
  clientSecret: string;
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
  const discordToken = process.env.DISCORD_BOT_TOKEN || '';
  const defaultGuildId = process.env.DISCORD_GUILD_ID || undefined;
  const allowedGuildIds = parseAllowedGuilds(process.env.ALLOWED_GUILD_IDS, defaultGuildId);

  // Transport configuration
  const transportArg = process.argv.includes('--sse') ? 'sse' : (process.argv.includes('--stdio') ? 'stdio' : null);
  const transportEnv = (process.env.MCP_TRANSPORT || '').toLowerCase() === 'sse' ? 'sse' : 'stdio';
  const transport = (transportArg || transportEnv) as 'stdio' | 'sse';

  const port = parseInt(process.env.MCP_PORT || '3000', 10);
  const host = process.env.MCP_HOST || '0.0.0.0';
  const authToken = process.env.MCP_AUTH_TOKEN || undefined;

  // Security guardrails
  const requireConfirmation = process.env.REQUIRE_CONFIRMATION !== 'false';
  const maxMessageHistory = Math.min(Math.max(parseInt(process.env.MAX_MESSAGE_HISTORY || '100', 10), 1), 100);

  // Mock / Test mode (enabled via --mock, MOCK_MODE=true, or automatically when DISCORD_BOT_TOKEN is not set)
  const mockMode = process.argv.includes('--mock') || process.env.MOCK_MODE === 'true' || !discordToken;

  const clientId = process.env.MCP_CLIENT_ID || 'moon-link-gemini';
  const clientSecret = process.env.MCP_CLIENT_SECRET || 'moon-link-secret-2026';

  return {
    discordToken,
    defaultGuildId,
    allowedGuildIds,
    transport,
    port,
    host,
    authToken,
    requireConfirmation,
    maxMessageHistory,
    mockMode,
    clientId,
    clientSecret
  };
}

export function maskToken(token?: string): string {
  if (!token) return '(not set)';
  if (token.length <= 8) return '****';
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
}
