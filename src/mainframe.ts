import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  Message,
  TextBasedChannel
} from 'discord.js';
import { AppConfig } from './config.js';
import { SessionStore } from './core/session-store.js';
import { PerKeyQueue } from './core/queue.js';
import { AgyRunner, getSanitizedEnvironment, parseTabSeparatedQuota } from './runners/agy.js';
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
    // Check if line toggles a code block
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
          // Close open code block before ending chunk
          chunks.push(currentChunk + '\n```');
          // Reopen code block at beginning of next chunk
          currentChunk = '```' + codeBlockLang + '\n' + line;
        } else {
          chunks.push(currentChunk);
          currentChunk = line;
        }
      } else {
        // Line itself exceeds maxLength, split cleanly in a loop
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
 * Preserves tables that are enclosed within code blocks.
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

    // Check code blocks
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(rawLine);
      continue;
    }

    if (inCodeBlock) {
      result.push(rawLine);
      continue;
    }

    // Check if line looks like a table row: starts and ends with |
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map(c => c.trim());

      // Check if separator line (| --- | :---: | --- |)
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        inTable = true;
        continue;
      }

      if (!inTable) {
        // Potential header row: peek ahead to verify next line is separator
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

      // In table body rows
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

  // 1. Redact configured application secrets if provided
  const botToken = config?.discordToken || process.env.DISCORD_BOT_TOKEN;
  if (botToken && botToken.length > 5) {
    cleaned = cleaned.replaceAll(botToken, '[REDACTED_BOT_TOKEN]');
  }
  const mcpToken = config?.authToken || process.env.MCP_AUTH_TOKEN;
  if (mcpToken && mcpToken.length > 5) {
    cleaned = cleaned.replaceAll(mcpToken, '[REDACTED_MCP_TOKEN]');
  }

  // 2. Redact Discord Bot Token format
  cleaned = cleaned.replace(/\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}\b/g, '[REDACTED_DISCORD_TOKEN]');
  cleaned = cleaned.replace(/\bmfa\.[A-Za-z0-9_-]{80,100}\b/g, '[REDACTED_MFA_TOKEN]');

  // 3. Redact GitHub Personal Access Tokens
  cleaned = cleaned.replace(/\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, '[REDACTED_GITHUB_PAT]');
  cleaned = cleaned.replace(/\bghp_[A-Za-z0-9]{36,}\b/g, '[REDACTED_GITHUB_TOKEN]');
  cleaned = cleaned.replace(/\bgh[ousr]_[A-Za-z0-9]{36,}\b/g, '[REDACTED_GITHUB_TOKEN]');

  // 4. Redact Bearer authorization tokens
  cleaned = cleaned.replace(/Bearer\s+[A-Za-z0-9_\-\.]{16,}/gi, 'Bearer [REDACTED_TOKEN]');

  // 5. Redact AI API keys & AWS access keys
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

  // 1. Redact secrets, tokens, and credentials
  text = redactSecrets(text, config);

  // 2. Strip ANSI escape sequences
  text = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

  // 3. Strip internal system / reasoning tags (fixing any <s> or <system> tags)
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  text = text.replace(/<observation>[\s\S]*?<\/observation>/gi, '');
  text = text.replace(/<context>[\s\S]*?<\/context>/gi, '');
  text = text.replace(/<system>[\s\S]*?<\/system>/gi, '');
  text = text.replace(/<s>[\s\S]*?<\/s>/gi, '');

  // 4. Prevent accidental mass mentions
  text = text.replace(/@(everyone|here)/g, '@\u200b$1');

  // 5. Convert markdown tables into bulleted lists
  text = convertMarkdownTablesToBullets(text);

  // 6. Demote oversized # and ## headings to ###
  text = text.replace(/^#\s+(.+)$/gm, '### $1');
  text = text.replace(/^##\s+(.+)$/gm, '### $1');

  // 7. Collapse excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Detects whether a prompt expresses a deletion or destructive intent
 */
export function isDeletionIntent(prompt: string): boolean {
  const DELETION_REGEX = /\b(delete|del|rm|remove|drop|truncate|purge|destroy|unlink|wipe|erase|clear|clean|flush|prune|empty|shred|format|discard)\b/i;
  return DELETION_REGEX.test(prompt);
}

/**
 * Checks if the user provided an explicit force or confirmation flag
 */
export function hasExplicitConfirmationFlag(prompt: string): boolean {
  return /(--force|-f|--confirm|--yes|-y)\b/i.test(prompt);
}

/**
 * Executes a prompt against AGY (backward-compatible delegate to AgyRunner)
 */
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

/**
 * Renders a visual text-based progress bar (e.g. [████████░░])
 */
export function renderProgressBar(fraction: number, length = 10): string {
  const safeFraction = typeof fraction === 'number' && !isNaN(fraction) ? fraction : 0;
  const clamped = Math.max(0, Math.min(1, safeFraction));
  const filled = Math.round(clamped * length);
  const empty = length - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Returns a color-coded status indicator emoji based on remaining quota fraction
 */
export function getQuotaStatusEmoji(fraction: number): string {
  if (typeof fraction !== 'number' || isNaN(fraction)) return '⚪';
  if (fraction >= 0.5) return '🟢';
  if (fraction >= 0.2) return '🟡';
  return '🔴';
}

/**
 * Formats structured model quota data into Discord-first markdown
 */
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

/**
 * Checks if a user prompt is intended to invoke the model quota command
 */
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

/**
 * Fetches model quota directly from the AGY CLI non-interactively
 */
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
 * Initializes the Mainframe Bridge to allow commanding AGY from #mainframe-channel
 */
export function initMainframeBridge(client: Client, config: AppConfig): void {
  if (config.mainframeEnabled === false) {
    console.error('[Mainframe] Mainframe bridge is disabled in configuration.');
    return;
  }

  const store = getSessionStore(config.dbPath);
  const targetChannelName = (config.mainframeChannel || 'mainframe-channel').toLowerCase();
  const prefix = (config.mainframePrefix || '!agy').toLowerCase();
  const authorizedUsers = new Set(config.mainframeAuthorizedUsers || []);
  const agyRunner = new AgyRunner({
    binPath: config.agyBinPath,
    defaultCwd: config.workDir,
    dangerouslySkipPermissions: config.skipPermissions
  });

  console.error(`[Mainframe] Bridge initialized. Listening on #${targetChannelName} (Prefix: "${prefix}" or @mentions). Working dir: ${config.workDir}`);

  client.on('messageCreate', async (message: Message) => {
    // 1. Ignore bot messages
    if (message.author.bot) return;

    // 2. Validate guild boundaries
    if (message.guildId && config.allowedGuildIds.length > 0 && !config.allowedGuildIds.includes(message.guildId)) {
      return;
    }

    // 3. Check channel: must be #mainframe-channel or a thread under it
    const channel = message.channel;
    const isDirectMainframe = 'name' in channel && Boolean(channel.name && channel.name.toLowerCase() === targetChannelName);
    const isThreadInMainframe = channel.isThread() && Boolean(channel.parent?.name && channel.parent.name.toLowerCase() === targetChannelName);

    if (!isDirectMainframe && !isThreadInMainframe) {
      return;
    }

    const content = message.content.trim();
    if (!content) return;

    // 4. Determine trigger condition
    const botMention = `<@${client.user?.id}>`;
    const botNicknameMention = `<@!${client.user?.id}>`;

    let prompt = '';
    let isTriggered = false;

    if (content.toLowerCase().startsWith(prefix)) {
      isTriggered = true;
      prompt = content.slice(prefix.length).trim();
    } else if (content.startsWith(botMention)) {
      isTriggered = true;
      prompt = content.slice(botMention.length).trim();
    } else if (content.startsWith(botNicknameMention)) {
      isTriggered = true;
      prompt = content.slice(botNicknameMention.length).trim();
    } else if (isThreadInMainframe) {
      isTriggered = true;
      prompt = content;
    }

    if (!isTriggered) return;

    // 5. Check Authorization
    if (!authorizedUsers.has(message.author.id)) {
      await message.reply('⛔ **Access Denied**: You are not authorized to issue commands to the AGY Mainframe.');
      return;
    }

    // Session Key:
    // If inside a thread: session key is the thread ID.
    // If in the direct mainframe channel: session key is 'main-session' (sticky persistent session).
    const sessionKey = channel.isThread() ? channel.id : `main-${channel.id}`;
    const targetChannel: TextBasedChannel = message.channel;
    const lowerPrompt = prompt.toLowerCase();

    // 6. Handle 'stop' Command
    if (lowerPrompt === 'stop' || lowerPrompt === 'abort' || lowerPrompt === 'cancel') {
      if (queue.isBusy(sessionKey)) {
        queue.abort(sessionKey);
        await message.react('🛑').catch(() => {});
        await (targetChannel as any).send('🛑 **Execution Aborted**: The active AGY process for this session has been cancelled. (Session context preserved).');
      } else {
        await (targetChannel as any).send('ℹ️ No active AGY execution is currently running in this session.');
      }
      return;
    }

    // 7. Handle Special Helper Commands
    if (lowerPrompt === 'help' || lowerPrompt === '--help') {
      await (targetChannel as any).send(
        `🖥️ **Antigravity Mainframe Bridge**\n\n` +
        `**Commands:**\n` +
        `• \`${prefix} <prompt>\` — Execute a prompt in AGY (maintains continuous context)\n` +
        `• \`${prefix} quota\` — View model quota, limits, and reset times\n` +
        `• \`${prefix} stop\` — Cancel the running AGY command in this session\n` +
        `• \`${prefix} reset\` (or \`new\`) — Start a fresh conversation\n` +
        `• \`${prefix} status\` — View active session info and bridge status\n` +
        `• \`${prefix} help\` — Show this help message\n\n` +
        `*Tip: Conversations persist across bot restarts in SQLite. Create a thread for isolated scratchpads.*`
      );
      return;
    }

    if (lowerPrompt === 'status') {
      const session = store.get(sessionKey);
      const activeId = session?.conversationId || '(No active conversation yet)';
      const msgCount = session?.messageCount || 0;
      await (targetChannel as any).send(
        `🖥️ **Mainframe Status:**\n` +
        `• **Target Channel:** #${targetChannelName}\n` +
        `• **Session Mode:** ${channel.isThread() ? '🧵 Thread Session' : '📌 Primary Persistent Session'}\n` +
        `• **Active Conversation ID:** \`${activeId}\`\n` +
        `• **Messages in Session:** ${msgCount}\n` +
        `• **Working Directory:** \`${config.workDir}\`\n` +
        `• **AGY Binary:** \`${config.agyBinPath}\`\n` +
        `• **Operator:** <@${message.author.id}>\n` +
        `• **Queue Busy:** ${queue.isBusy(sessionKey) ? '⏳ Yes' : '🟢 Idle'}`
      );
      return;
    }

    if (lowerPrompt === 'new' || lowerPrompt === 'reset') {
      store.delete(sessionKey);
      await (targetChannel as any).send('🔄 **Session Reset**: Your next message will begin a brand-new conversation session with AGY.');
      return;
    }

    if (isModelQuotaCommand(prompt)) {
      try {
        await message.react('📊').catch(() => {});
        if ('sendTyping' in targetChannel && typeof (targetChannel as any).sendTyping === 'function') {
          await (targetChannel as any).sendTyping().catch(() => {});
        }

        const isRaw = /(--json|-j|--raw|-r)\b/i.test(prompt);
        const quotaResult = await agyRunner.fetchQuota(config.workDir);

        if (!quotaResult.success) {
          await message.reactions.removeAll().catch(() => {});
          await message.react('❌').catch(() => {});
          const safeErr = redactSecrets(quotaResult.error || 'Failed to query model quota', config);
          await (targetChannel as any).send(`❌ **Failed to retrieve model quota**:\n\`\`\`text\n${safeErr}\n\`\`\``);
          return;
        }

        await message.reactions.removeAll().catch(() => {});
        await message.react('✅').catch(() => {});

        if (isRaw) {
          const payload = quotaResult.data ? JSON.stringify(quotaResult.data, null, 2) : (quotaResult.rawText || '{}');
          const chunks = splitDiscordMessage(`### 📊 Model Quota (Raw Data)\n\`\`\`json\n${payload}\n\`\`\``);
          for (const chunk of chunks) {
            await (targetChannel as any).send(chunk);
          }
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

        const chunks = splitDiscordMessage(messageToSend);
        for (const chunk of chunks) {
          await (targetChannel as any).send(chunk);
        }
      } catch (quotaErr: any) {
        await message.reactions.removeAll().catch(() => {});
        await message.react('❌').catch(() => {});
        const safeErr = redactSecrets(quotaErr.message || String(quotaErr), config);
        await (targetChannel as any).send(`❌ **Unexpected Error**: ${safeErr}`).catch(() => {});
      }
      return;
    }

    if (!prompt) {
      await (targetChannel as any).send(`Please provide a prompt after \`${prefix}\`. Example: \`${prefix} what is the current git status?\``);
      return;
    }

    // 8. Check Deletion / Destructive Intent & Confirmation
    if (isDeletionIntent(prompt) && !hasExplicitConfirmationFlag(prompt)) {
      const confirmButton = new ButtonBuilder()
        .setCustomId('confirm_deletion')
        .setLabel('Confirm Deletion')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️');

      const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_deletion')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️');

      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);
      const promptPreview = prompt.length > 200 ? prompt.slice(0, 200) + '...' : prompt;

      const confirmMsg = await (targetChannel as any).send({
        content:
          `⚠️ **Deletion Confirmation Required**\n` +
          `Your prompt contains a deletion or destructive operation request:\n` +
          `> \`${promptPreview}\`\n\n` +
          `Click **Confirm Deletion** to proceed or **Cancel** to abort. *(Auto-cancels in 60s)*`,
        components: [actionRow]
      });

      try {
        const interaction = await confirmMsg.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i: any) => i.user.id === message.author.id,
          time: 60000
        });

        if (interaction.customId === 'cancel_deletion') {
          await interaction.update({
            content: `❌ **Operation Cancelled**: Deletion request was cancelled by <@${message.author.id}>.`,
            components: []
          });
          return;
        }

        await interaction.update({
          content: `🗑️ **Deletion Confirmed** by <@${message.author.id}>. Dispatching to AGY...`,
          components: []
        });
      } catch {
        await confirmMsg.edit({
          content: `⏳ **Operation Cancelled**: Deletion confirmation timed out after 60 seconds.`,
          components: []
        }).catch(() => {});
        return;
      }
    }

    // 9. Execute AGY Prompt via FIFO Queue for this session
    await message.react('⚙️').catch(() => {});

    await queue.enqueue(sessionKey, async (signal: AbortSignal) => {
      const currentConvId = store.getConversationId(sessionKey) || undefined;

      // Periodic typing indicator while running
      const typingInterval = setInterval(() => {
        if ('sendTyping' in targetChannel && typeof (targetChannel as any).sendTyping === 'function') {
          (targetChannel as any).sendTyping().catch(() => {});
        }
      }, 7000);

      try {
        if ('sendTyping' in targetChannel && typeof (targetChannel as any).sendTyping === 'function') {
          await (targetChannel as any).sendTyping().catch(() => {});
        }

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
          await message.reactions.removeAll().catch(() => {});
          await message.react('🛑').catch(() => {});
          return;
        }

        if (result.error) {
          await message.reactions.removeAll().catch(() => {});
          await message.react('❌').catch(() => {});
          const safeError = redactSecrets(result.error, config);
          await (targetChannel as any).send(`❌ **AGY Execution Error**:\n\`\`\`text\n${safeError}\n\`\`\``);
          return;
        }

        // Save conversation ID to SQLite
        if (result.conversationId) {
          store.set(sessionKey, result.conversationId, {
            channelId: channel.id,
            isThread: channel.isThread(),
            authorId: message.author.id
          });
        }

        await message.reactions.removeAll().catch(() => {});
        await message.react('✅').catch(() => {});

        const formatted = formatForDiscord(result.response || '(Done with no output)', config);
        const chunks = splitDiscordMessage(formatted, 1900);

        for (const chunk of chunks) {
          await (targetChannel as any).send(chunk);
        }
      } catch (err: any) {
        clearInterval(typingInterval);
        await message.reactions.removeAll().catch(() => {});
        await message.react('❌').catch(() => {});
        const safeErr = redactSecrets(err.message || String(err), config);
        await (targetChannel as any).send(`❌ **Unexpected Error**: ${safeErr}`).catch(() => {});
      }
    });
  });

  // Handle Slash Commands
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'quota' || interaction.commandName === 'model-quota') {
      if (interaction.guildId && config.allowedGuildIds.length > 0 && !config.allowedGuildIds.includes(interaction.guildId)) {
        await interaction.reply({ content: '⛔ This server is not authorized for Hyposea Mainframe commands.', ephemeral: true });
        return;
      }

      if (!authorizedUsers.has(interaction.user.id)) {
        await interaction.reply({ content: '⛔ **Access Denied**: You are not authorized to query the AGY Mainframe.', ephemeral: true });
        return;
      }

      await interaction.deferReply();
      try {
        const quotaResult = await agyRunner.fetchQuota(config.workDir);
        if (!quotaResult.success) {
          const safeErr = redactSecrets(quotaResult.error || 'Failed to query quota', config);
          await interaction.editReply(`❌ **Failed to retrieve model quota**:\n\`\`\`text\n${safeErr}\n\`\`\``);
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

        await interaction.editReply(messageToSend);
      } catch (err: any) {
        const safeErr = redactSecrets(err.message || String(err), config);
        await interaction.editReply(`❌ **Error fetching quota**: ${safeErr}`);
      }
    }
  });
}
