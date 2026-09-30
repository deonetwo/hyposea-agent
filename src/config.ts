import { loadHyposeaConfig, maskSecret } from './config/load.js';

export interface AppConfig {
  discordToken: string;
  mainframeEnabled: boolean;
  mainframeChannel: string;
  mainframeAuthorizedUsers: string[];
  mainframePrefix: string;
  agyBinPath: string;
  allowedGuildIds: string[];
  workDir: string;
  dbPath: string;
  skipPermissions: boolean;
}

export function loadConfig(): AppConfig {
  return loadHyposeaConfig();
}

export { maskSecret };
