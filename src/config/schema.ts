import { z } from 'zod';

export const ConfigYamlSchema = z.object({
  channel: z.string().default('mainframe-channel').describe('Discord channel name to listen on'),
  prefix: z.string().default('!agy').describe('Command prefix'),
  authorizedUsers: z.array(z.string()).default([]).describe('Allowed Discord user snowflake IDs'),
  allowedGuildIds: z.array(z.string()).default([]).describe('Optional allowed guild IDs'),
  agyBinPath: z.string().default('/home/ubuntu/.local/bin/agy').describe('Path to agy executable'),
  workDir: z.string().optional().describe('Working directory for AGY commands'),
  skipPermissions: z.boolean().default(false).describe('Auto-approve tool permissions (conservative default false)')
});

export const SecretsSchema = z.object({
  discordToken: z.string().min(1, 'DISCORD_BOT_TOKEN is required in secrets.env')
});

export type ConfigYaml = z.infer<typeof ConfigYamlSchema>;
export type Secrets = z.infer<typeof SecretsSchema>;
