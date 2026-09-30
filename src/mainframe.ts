import { AppConfig } from './config.js';
import { SessionStore } from './core/session-store.js';
import { PerKeyQueue } from './core/queue.js';
import { AgyRunner, getSanitizedEnvironment, parseTabSeparatedQuota } from './runners/agy.js';
import { Channel, InboundMessage } from './channels/channel.js';
import {
  ModelQuotaData,
  ModelQuotaResult,
  RunResult as AgyRunResult
} from './core/types.js';

export {
  getSanitizedEnvironment,
  parseTabSeparatedQuota,
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

/**
 * Splits long responses into chunks within Discord's 2000 character limit
 * while preserving markdown code block formatting.
 */
export function splitDiscordMessage(text: string, maxLength = 1900): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split('\n');
  let currentChunk = '';
  let inCodeBlock = false;
  let codeBlockLang = '';

  for (const line of lines) {
    const codeBlockMatch = line.match(/^```(\w*)/);
    if (codeBlockMatch) {
      if (inCodeBlock) {
        inCodeBlock = false;
        codeBlockLang = '';
      } else {
        inCodeBlock = true;
        codeBlockLang = codeBlockMatch[1] || '';
      }
    }

    if ((currentChunk + '\n' + line).length > maxLength) {
      if (currentChunk.length > 0) {
        if (inCodeBlock) {
          chunks.push(currentChunk + '\n```');
          currentChunk = '```' + codeBlockLang + '\n' + line;
        } else {
          chunks.push(currentChunk);
          currentChunk = line;
        }
      } else {
        let remaining = line;
        while (remaining.length > maxLength) {
          chunks.push(remaining.slice(0, maxLength));
          remaining = remaining.slice(maxLength);
        }
        currentChunk = remaining;
      }
    } else {
      currentChunk = currentChunk.length === 0 ? line : currentChunk + '\n' + line;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Converts markdown tables to clean Discord-friendly bulleted lists.
 */
export function convertMarkdownTablesToBullets(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let inTable = false;
  let headers: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(rawLine);
      continue;
    }

    if (inCodeBlock) {
      result.push(rawLine);
      continue;
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map(c => c.trim());

      if (cells.every(c => /^:?-+:?$/.test(c))) {
        inTable = true;
        continue;
      }

      if (!inTable) {
        const nextLine = lines[i + 1]?.trim();
        if (nextLine && nextLine.startsWith('|') && nextLine.includes('-')) {
          headers = cells;
          continue;
        } else {
          result.push(rawLine);
          headers = [];
          continue;
        }
      }

      if (headers.length > 0) {
        if (headers.length === 2) {
          result.push(`• **${cells[0]}:** ${cells[1] || ''}`);
        } else {
          const formattedCells = cells.map((cell, idx) => {
            const h = headers[idx] ? `**${headers[idx]}:** ` : '';
            return `${h}${cell}`;
          });
          result.push(`• ${formattedCells.join(' • ')}`);
        }
      } else {
        result.push(`• ${cells.join(' | ')}`);
      }
    } else {
      inTable = false;
      headers = [];
      result.push(rawLine);
    }
  }

  return result.join('\n');
}

/**
 * Redacts secrets, tokens, and credentials from text before outputting to Discord.
 */
export function redactSecrets(text: string, config?: Partial<AppConfig> & { authToken?: string }): string {
  if (!text) return '';
  let cleaned = text;

  const botToken = config?.discordToken || process.env.DISCORD_BOT_TOKEN;
  if (botToken && botToken.length > 5) {
    cleaned = cleaned.replaceAll(botToken, '[REDACTED_BOT_TOKEN]');
  }
  const mcpToken = config?.authToken || process.env.MCP_AUTH_TOKEN;
  if (mcpToken && mcpToken.length > 5) {
    cleaned = cleaned.replaceAll(mcpToken, '[REDACTED_MCP_TOKEN]');
  }

  cleaned = cleaned.replace(/\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}\b/g, '[REDACTED_DISCORD_TOKEN]');
  cleaned = cleaned.replace(/\bmfa\.[A-Za-z0-9_-]{80,100}\b/g, '[REDACTED_MFA_TOKEN]');
  cleaned = cleaned.replace(/\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, '[REDACTED_GITHUB_PAT]');
  cleaned = cleaned.replace(/\bghp_[A-Za-z0-9]{36,}\b/g, '[REDACTED_GITHUB_TOKEN]');
  cleaned = cleaned.replace(/\bgh[ousr]_[A-Za-z0-9]{36,}\b/g, '[REDACTED_GITHUB_TOKEN]');
  cleaned = cleaned.replace(/Bearer\s+[A-Za-z0-9_\-\.]{16,}/gi, 'Bearer [REDACTED_TOKEN]');
  cleaned = cleaned.replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g, '[REDACTED_AI_API_KEY]');
  cleaned = cleaned.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');

  return cleaned;
}

/**
 * Filter and format raw output for clean, polished Discord display.
 */
export function formatForDiscord(raw: string, config?: Partial<AppConfig> & { authToken?: string }): string {
  if (!raw) return '';

  let text = raw;

  text = redactSecrets(text, config);
  text = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  text = text.replace(/<observation>[\s\S]*?<\/observation>/gi, '');
  text = text.replace(/<context>[\s\S]*?<\/context>/gi, '');
  text = text.replace(/<system>[\s\S]*?<\/system>/gi, '');
  text = text.replace(/<s>[\s\S]*?<\/s>/gi, '');
  text = text.replace(/@(everyone|here)/g, '@\u200b$1');
  text = convertMarkdownTablesToBullets(text);
  text = text.replace(/^#\s+(.+)$/gm, '### $1');
  text = text.replace(/^##\s+(.+)$/gm, '### $1');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

export function isDeletionIntent(prompt: string): boolean {
  const DELETION_REGEX = /\b(delete|del|rm|remove|drop|truncate|purge|destroy|unlink|wipe|erase|clear|clean|flush|prune|empty|shred|format|discard)\b/i;
  return DELETION_REGEX.test(prompt);
}

export function hasExplicitConfirmationFlag(prompt: string): boolean {
  return /(--force|-f|--confirm|--yes|-y)\b/i.test(prompt);
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

export function renderProgressBar(fraction: number, length = 10): string {
  const safeFraction = typeof fraction === 'number' && !isNaN(fraction) ? fraction : 0;
  const clamped = Math.max(0, Math.min(1, safeFraction));
  const filled = Math.round(clamped * length);
  const empty = length - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

export function getQuotaStatusEmoji(fraction: number): string {
  if (typeof fraction !== 'number' || isNaN(fraction)) return '⚪';
  if (fraction >= 0.5) return '🟢';
  if (fraction >= 0.2) return '🟡';
  return '🔴';
}

export function formatQuotaForDiscord(data: ModelQuotaData): string {
  const lines: string[] = [];

  lines.push('### 📊 Model Quota & Usage Limits\n');

  if (!data.groups || data.groups.length === 0) {
    lines.push('• No active model quota buckets found.');
    return lines.join('\n');
  }

  for (const group of data.groups) {
    const isGemini = group.name.toLowerCase().includes('gemini');
    const groupEmoji = isGemini ? '🤖' : '🧠';
    lines.push(`**${groupEmoji} ${group.name}**`);
    if (group.description) {
      lines.push(`• *${group.description}*`);
    }

    for (const bucket of group.buckets) {
      const fraction = typeof bucket.remaining_fraction === 'number' && !isNaN(bucket.remaining_fraction)
        ? bucket.remaining_fraction
        : 1;
      const pct = Math.round(fraction * 100);
      const emoji = getQuotaStatusEmoji(fraction);
      const bar = renderProgressBar(fraction, 10);

      let resetPart = '';
      if (bucket.reset_time) {
        const resetDate = new Date(bucket.reset_time);
        const unixSeconds = Math.floor(resetDate.getTime() / 1000);
        if (!isNaN(unixSeconds) && unixSeconds > 0) {
          resetPart = ` • Resets <t:${unixSeconds}:R>`;
        }
      }

      lines.push(`• **${bucket.name}:** ${emoji} \`${pct}%\` ${bar}${resetPart}`);
      if (bucket.description) {
        lines.push(`  ↳ *${bucket.description}*`);
      }
    }
    lines.push('');
  }

  lines.push('⚡ *Within each group, models share a weekly and 5-hour limit. Quota is consumed proportionally based on token cost.*');

  return lines.join('\n').trim();
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

  return triggers.some(t => clean === t || clean.startsWith(`${t} `));
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
 * Initializes the Mainframe Bridge to listen via a Channel adapter
 */
export function initMainframeBridge(channel: Channel, config: AppConfig): void {
  if (config.mainframeEnabled === false) {
    console.error('[Mainframe] Mainframe bridge is disabled in configuration.');
    return;
  }

  const store = getSessionStore(config.dbPath);
  const targetChannelName = (config.mainframeChannel || 'mainframe-channel').toLowerCase();
  const prefix = (config.mainframePrefix || '!agy').toLowerCase();
  const agyRunner = new AgyRunner({
    binPath: config.agyBinPath,
    defaultCwd: config.workDir,
    dangerouslySkipPermissions: config.skipPermissions
  });

  const sendResponse = async (channelId: string, text: string) => {
    const chunks = splitDiscordMessage(text, 1900);
    for (const chunk of chunks) {
      await channel.send({ channelId }, { content: chunk });
    }
  };

  channel.start(async (msg: InboundMessage) => {
    const sessionKey = msg.isDm
      ? `dm-${msg.authorId}`
      : msg.isThread
      ? msg.channelId
      : `main-${msg.channelId}`;

    const prompt = msg.content.trim();
    const lowerPrompt = prompt.toLowerCase();

    // 1. Handle 'stop' Command
    if (lowerPrompt === 'stop' || lowerPrompt === 'abort' || lowerPrompt === 'cancel') {
      if (queue.isBusy(sessionKey)) {
        queue.abort(sessionKey);
        if (msg.react) await msg.react('🛑');
        await sendResponse(msg.channelId, '🛑 **Execution Aborted**: The active AGY process for this session has been cancelled. (Session context preserved).');
      } else {
        await sendResponse(msg.channelId, 'ℹ️ No active AGY execution is currently running in this session.');
      }
      return;
    }

    // 2. Handle 'help' Command
    if (lowerPrompt === 'help' || lowerPrompt === '--help') {
      await sendResponse(
        msg.channelId,
        `🖥️ **Antigravity Mainframe Bridge**\n\n` +
        `**Commands:**\n` +
        `• \`${prefix} <prompt>\` — Execute a prompt in AGY (maintains continuous context)\n` +
        `• \`${prefix} quota\` — View model quota, limits, and reset times\n` +
        `• \`${prefix} stop\` — Cancel the running AGY command in this session\n` +
        `• \`${prefix} reset\` (or \`new\`) — Start a fresh conversation\n` +
        `• \`${prefix} status\` — View active session info and bridge status\n` +
        `• \`${prefix} help\` — Show this help message\n\n` +
        `*Tip: Conversations persist across bot restarts in SQLite. Direct Messages with registered owner IDs are fully private and persistent.*`
      );
      return;
    }

    // 3. Handle 'status' Command
    if (lowerPrompt === 'status') {
      const session = store.get(sessionKey);
      const activeId = session?.conversationId || '(No active conversation yet)';
      const msgCount = session?.messageCount || 0;
      await sendResponse(
        msg.channelId,
        `🖥️ **Mainframe Status:**\n` +
        `• **Target Channel:** #${targetChannelName}\n` +
        `• **Session Mode:** ${msg.isDm ? '💬 Private Direct Message (DM)' : msg.isThread ? '🧵 Thread Session' : '📌 Primary Persistent Session'}\n` +
        `• **Active Conversation ID:** \`${activeId}\`\n` +
        `• **Messages in Session:** ${msgCount}\n` +
        `• **Working Directory:** \`${config.workDir}\`\n` +
        `• **AGY Binary:** \`${config.agyBinPath}\`\n` +
        `• **Operator:** <@${msg.authorId}> (${msg.authorName})\n` +
        `• **Queue Busy:** ${queue.isBusy(sessionKey) ? '⏳ Yes' : '🟢 Idle'}`
      );
      return;
    }

    // 4. Handle 'reset' / 'new' Command
    if (lowerPrompt === 'reset' || lowerPrompt === 'new') {
      store.delete(sessionKey);
      await sendResponse(msg.channelId, '🔄 **Session Reset**: Your next message will begin a brand-new conversation session with AGY.');
      return;
    }

    // 5. Handle Model Quota Command
    if (isModelQuotaCommand(prompt)) {
      try {
        if (msg.react) await msg.react('📊');
        if (msg.sendTyping) await msg.sendTyping();

        const isRaw = /(--json|-j|--raw|-r)\b/i.test(prompt);
        const quotaResult = await agyRunner.fetchQuota(config.workDir);

        if (!quotaResult.success) {
          if (msg.clearReactions) await msg.clearReactions();
          if (msg.react) await msg.react('❌');
          const safeErr = redactSecrets(quotaResult.error || 'Failed to query model quota', config);
          await sendResponse(msg.channelId, `❌ **Failed to retrieve model quota**:\n\`\`\`text\n${safeErr}\n\`\`\``);
          return;
        }

        if (msg.clearReactions) await msg.clearReactions();
        if (msg.react) await msg.react('✅');

        if (isRaw) {
          const payload = quotaResult.data ? JSON.stringify(quotaResult.data, null, 2) : (quotaResult.rawText || '{}');
          await sendResponse(msg.channelId, `### 📊 Model Quota (Raw Data)\n\`\`\`json\n${payload}\n\`\`\``);
          return;
        }

        let messageToSend = '';
        if (quotaResult.data && quotaResult.data.groups && quotaResult.data.groups.length > 0) {
          messageToSend = formatQuotaForDiscord(quotaResult.data);
        } else if (quotaResult.rawText) {
          messageToSend = formatForDiscord(quotaResult.rawText, config);
        } else {
          messageToSend = '• **Model Quota:** No quota information available.';
        }

        await sendResponse(msg.channelId, messageToSend);
      } catch (quotaErr: any) {
        if (msg.clearReactions) await msg.clearReactions();
        if (msg.react) await msg.react('❌');
        const safeErr = redactSecrets(quotaErr.message || String(quotaErr), config);
        await sendResponse(msg.channelId, `❌ **Unexpected Error**: ${safeErr}`);
      }
      return;
    }

    if (!prompt) {
      await sendResponse(msg.channelId, `Please provide a prompt after \`${prefix}\`. Example: \`${prefix} what is the current git status?\``);
      return;
    }

    // 6. Check Deletion / Destructive Intent
    if (isDeletionIntent(prompt) && !hasExplicitConfirmationFlag(prompt)) {
      if (msg.confirmAction) {
        const confirmed = await msg.confirmAction(prompt);
        if (!confirmed) {
          return;
        }
      }
    }

    // 7. Enqueue AGY execution for this session
    if (msg.react) await msg.react('⚙️');

    await queue.enqueue(sessionKey, async (signal: AbortSignal) => {
      const currentConvId = store.getConversationId(sessionKey) || undefined;

      const typingInterval = setInterval(() => {
        if (msg.sendTyping) msg.sendTyping().catch(() => {});
      }, 7000);

      try {
        if (msg.sendTyping) await msg.sendTyping().catch(() => {});

        const sessionPrompt = currentConvId
          ? prompt
          : `[Context: Active Discord session in #${targetChannelName}. Strictly adhere to discord-display skill guidelines: use ### headers, emoji bullets, no markdown tables, concise direct tone]\n\n${prompt}`;

        const result = await agyRunner.run({
          prompt: sessionPrompt,
          sessionId: currentConvId,
          cwd: config.workDir,
          signal
        });

        clearInterval(typingInterval);

        if (result.aborted) {
          if (msg.clearReactions) await msg.clearReactions().catch(() => {});
          if (msg.react) await msg.react('🛑').catch(() => {});
          return;
        }

        if (result.error) {
          if (msg.clearReactions) await msg.clearReactions().catch(() => {});
          if (msg.react) await msg.react('❌').catch(() => {});
          const safeError = redactSecrets(result.error, config);
          await sendResponse(msg.channelId, `❌ **AGY Execution Error**:\n\`\`\`text\n${safeError}\n\`\`\``);
          return;
        }

        if (result.conversationId) {
          store.set(sessionKey, result.conversationId, {
            channelId: msg.channelId,
            isDm: msg.isDm,
            isThread: msg.isThread,
            authorId: msg.authorId
          });
        }

        if (msg.clearReactions) await msg.clearReactions().catch(() => {});
        if (msg.react) await msg.react('✅').catch(() => {});

        const formatted = formatForDiscord(result.response || '(Done with no output)', config);
        await sendResponse(msg.channelId, formatted);
      } catch (err: any) {
        clearInterval(typingInterval);
        if (msg.clearReactions) await msg.clearReactions().catch(() => {});
        if (msg.react) await msg.react('❌').catch(() => {});
        const safeErr = redactSecrets(err.message || String(err), config);
        await sendResponse(msg.channelId, `❌ **Unexpected Error**: ${safeErr}`);
      }
    });
  });
}
