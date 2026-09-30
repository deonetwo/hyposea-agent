import { AppConfig } from './config.js';
import { SessionStore } from './core/session-store.js';
import { PerKeyQueue } from './core/queue.js';
import { AgyRunner, getSanitizedEnvironment, parseTabSeparatedQuota } from './runners/agy.js';
import { Channel } from './channels/channel.js';
import { Pipeline } from './core/pipeline.js';
import {
  convertMarkdownTablesToBullets,
  formatForDiscord,
  formatQuotaForDiscord,
  getQuotaStatusEmoji,
  redactSecrets,
  renderProgressBar,
  splitDiscordMessage
} from './modules/formatter/index.js';
import { hasExplicitConfirmationFlag, isDeletionIntent } from './modules/guard/index.js';
import {
  ModelQuotaData,
  ModelQuotaResult,
  RunResult as AgyRunResult
} from './core/types.js';

export {
  getSanitizedEnvironment,
  parseTabSeparatedQuota,
  convertMarkdownTablesToBullets,
  formatForDiscord,
  formatQuotaForDiscord,
  getQuotaStatusEmoji,
  hasExplicitConfirmationFlag,
  isDeletionIntent,
  redactSecrets,
  renderProgressBar,
  splitDiscordMessage,
  AgyRunResult,
  ModelQuotaData,
  ModelQuotaResult
};

// Singleton session store and execution queue
let sessionStore: SessionStore | null = null;
const queue = new PerKeyQueue();

export function getSessionStore(dbPath?: string): SessionStore {
  if (!sessionStore) {
    sessionStore = new SessionStore({ dbPath });
  }
  return sessionStore;
}

export function getQueue(): PerKeyQueue {
  return queue;
}

export function isModelQuotaCommand(prompt: string): boolean {
  const clean = prompt.trim().toLowerCase();
  const triggers = [
    'quota',
    '/quota',
    'model-quota',
    'modelquota',
    'model quota',
    'models-quota',
    'models quota',
    'usage',
    '/usage',
    'model usage',
    'view quota',
    'view model quota',
    'view models quota',
    'check quota',
    'show quota',
    'get quota',
    'limits',
    'model limits',
    'quota limits'
  ];

  return triggers.some((t) => clean === t || clean.startsWith(`${t} `));
}

export async function runAgyCommand(
  prompt: string,
  conversationId?: string,
  agyBin = '/home/ubuntu/.local/bin/agy',
  cwd = process.cwd()
): Promise<AgyRunResult> {
  const runner = new AgyRunner({
    binPath: agyBin,
    defaultCwd: cwd,
    dangerouslySkipPermissions: true
  });

  return runner.run({
    prompt,
    sessionId: conversationId,
    cwd
  });
}

export async function fetchModelQuota(
  agyBin = '/home/ubuntu/.local/bin/agy',
  cwd = process.cwd()
): Promise<ModelQuotaResult> {
  const runner = new AgyRunner({
    binPath: agyBin,
    defaultCwd: cwd,
    dangerouslySkipPermissions: true
  });
  return runner.fetchQuota(cwd);
}

/**
 * Initializes the Mainframe Bridge by creating and starting a Pipeline
 */
export function initMainframeBridge(channel: Channel, config: AppConfig): Pipeline | void {
  if (config.mainframeEnabled === false) {
    console.error('[Mainframe] Mainframe bridge is disabled in configuration.');
    return;
  }

  const store = getSessionStore(config.dbPath);
  const runner = new AgyRunner({
    binPath: config.agyBinPath,
    defaultCwd: config.workDir,
    dangerouslySkipPermissions: config.skipPermissions
  });

  const pipeline = new Pipeline({
    channel,
    runner,
    store,
    queue,
    config
  });

  pipeline.start().catch((err) => {
    console.error('[Mainframe] Pipeline startup failed:', err);
  });

  return pipeline;
}
