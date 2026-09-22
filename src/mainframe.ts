import { execFile } from 'node:child_process';
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

interface AgyRunResult {
  response: string;
  conversationId?: string;
  durationSeconds?: number;
  tokensUsed?: number;
  error?: string;
}

// Stores conversationId per channel/thread to maintain conversation history
const sessionMap = new Map<string, string>();

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
        // Line itself exceeds maxLength, split hard
        chunks.push(line.slice(0, maxLength));
        currentChunk = line.slice(maxLength);
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

      // We are in the table body rows
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
export function redactSecrets(text: string, config?: AppConfig): string {
  if (!text) return '';
  let cleaned = text;

  // 1. Redact configured application secrets if provided (or from env fallback)
  const botToken = config?.discordToken || process.env.DISCORD_BOT_TOKEN;
  if (botToken && botToken.length > 5) {
    cleaned = cleaned.replaceAll(botToken, '[REDACTED_BOT_TOKEN]');
  }
  const mcpToken = config?.authToken || process.env.MCP_AUTH_TOKEN;
  if (mcpToken && mcpToken.length > 5) {
    cleaned = cleaned.replaceAll(mcpToken, '[REDACTED_MCP_TOKEN]');
  }

  // 2. Redact Discord Bot Token format (e.g. MTU0...bqDY or MFA token)
  cleaned = cleaned.replace(/\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}\b/g, '[REDACTED_DISCORD_TOKEN]');
  cleaned = cleaned.replace(/\bmfa\.[A-Za-z0-9_-]{80,100}\b/g, '[REDACTED_MFA_TOKEN]');

  // 3. Redact GitHub Personal Access Tokens (classic ghp_ and fine-grained github_pat_)
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
export function formatForDiscord(raw: string, config?: AppConfig): string {
  if (!raw) return '';

  let text = raw;

  // 1. Redact secrets, tokens, and credentials
  text = redactSecrets(text, config);

  // 2. Strip ANSI escape sequences (terminal colors, cursor movements)
  text = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

  // 3. Strip internal system / reasoning tags
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  text = text.replace(/<observation>[\s\S]*?<\/observation>/gi, '');
  text = text.replace(/<context>[\s\S]*?<\/context>/gi, '');
  text = text.replace(/<system>[\s\S]*?<\/system>/gi, '');

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
 * Generates a sanitized environment object for child process execution,
 * stripping sensitive tokens, credentials, and API keys.
 */
export function getSanitizedEnvironment(): NodeJS.ProcessEnv {
  const SENSITIVE_KEYS = new Set([
    'DISCORD_BOT_TOKEN',
    'MCP_AUTH_TOKEN',
    'GITHUB_PAT',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY'
  ]);

  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    const lowerKey = key.toLowerCase();
    // Omit sensitive keys or variables containing token/secret/password/auth
    if (
      SENSITIVE_KEYS.has(key) ||
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('password') ||
      lowerKey.includes('auth')
    ) {
      continue;
    }
    sanitized[key] = val;
  }

  sanitized['PAGER'] = 'cat';
  sanitized['TERM'] = 'xterm-256color';
  return sanitized;
}

/**
 * Executes a prompt against the AGY CLI non-interactively in json mode
 */
export async function runAgyCommand(
  prompt: string,
  conversationId?: string,
  agyBin = '/home/ubuntu/.local/bin/agy',
  cwd = '/home/ubuntu/moon-link'
): Promise<AgyRunResult> {
  return new Promise((resolve) => {
    const args = [
      '--dangerously-skip-permissions',
      '--add-dir',
      cwd,
      '--output-format',
      'json'
    ];

    if (conversationId) {
      args.push('--conversation', conversationId);
    }

    // Explicitly enforce discord-display skill guidelines for Discord active sessions
    const sessionPrompt = conversationId
      ? prompt
      : `[Context: Active Discord session in #mainframe-channel. Strictly adhere to discord-display skill guidelines: use ### headers, emoji bullets, no markdown tables, concise direct tone]\n\n${prompt}`;

    args.push('-p', sessionPrompt);

    execFile(
      agyBin,
      args,
      {
        cwd,
        timeout: 300000, // 5 min timeout
        maxBuffer: 15 * 1024 * 1024,
        env: getSanitizedEnvironment()
      },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          return resolve({
            response: '',
            error: err.message || (stderr ? stderr.trim() : 'Unknown AGY execution error')
          });
        }

        const rawOutput = (stdout || '').trim();
        try {
          // Attempt to parse JSON response from agy
          const parsed = JSON.parse(rawOutput);
          return resolve({
            response: parsed.response || rawOutput,
            conversationId: parsed.conversation_id,
            durationSeconds: parsed.duration_seconds,
            tokensUsed: parsed.usage?.total_tokens
          });
        } catch {
          // Fallback if stdout contains raw non-JSON text
          return resolve({
            response: rawOutput || (stderr ? stderr.trim() : '(Empty response)'),
            conversationId
          });
        }
      }
    );
  });
}

/**
 * Initializes the Mainframe Bridge to allow commanding AGY from #mainframe-channel
 */
export function initMainframeBridge(client: Client, config: AppConfig): void {
  if (config.mainframeEnabled === false) {
    console.error('[Mainframe] Mainframe bridge is disabled in configuration.');
    return;
  }

  const targetChannelName = (config.mainframeChannel || 'mainframe-channel').toLowerCase();
  const prefix = (config.mainframePrefix || '!agy').toLowerCase();
  const authorizedUsers = new Set(config.mainframeAuthorizedUsers || ['515099684893622277']);
  const agyBin = config.agyBinPath || '/home/ubuntu/.local/bin/agy';

  console.error(`[Mainframe] Bridge initialized. Listening on #${targetChannelName} for prefix "${prefix}" or @mentions.`);

  client.on('messageCreate', async (message: Message) => {
    // 1. Ignore bot messages to prevent infinite loops
    if (message.author.bot) return;

    // 2. Validate guild boundaries if guild ID is present
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

    // 4. Determine trigger condition:
    // - Prefix match (e.g. "!agy ...")
    // - Mention match (e.g. "@Hyposea Agent ...")
    // - In thread under mainframe: all messages from authorized users trigger
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

    // 5. Check Authorization: restrict strictly to authorized user
    if (!authorizedUsers.has(message.author.id)) {
      await message.reply('⛔ **Access Denied**: You are not authorized to issue commands to the AGY Mainframe.');
      return;
    }

    // 6. Ensure Execution Occurs in a Thread if called in #mainframe-channel
    let targetChannel: TextBasedChannel = message.channel;
    if (!message.channel.isThread()) {
      try {
        if (message.hasThread && message.thread) {
          targetChannel = message.thread;
        } else if ('startThread' in message && typeof message.startThread === 'function') {
          const promptSummary = prompt.replace(/[\r\n]+/g, ' ').trim();
          const cleanName = promptSummary.length > 50
            ? `${promptSummary.slice(0, 47)}...`
            : (promptSummary || 'AGY Session');
          targetChannel = await message.startThread({
            name: `🤖 ${cleanName}`,
            autoArchiveDuration: 60
          });
        }
      } catch (threadErr: any) {
        console.error('[Mainframe] Thread creation failed, falling back to message channel:', threadErr.message);
        targetChannel = message.channel;
      }
    }

    // 7. Handle Special Helper Commands
    const lowerPrompt = prompt.toLowerCase();

    if (lowerPrompt === 'help' || lowerPrompt === '--help') {
      await (targetChannel as any).send(
        `🖥️ **Antigravity Mainframe Bridge**\n\n` +
        `**Commands:**\n` +
        `• \`${prefix} <prompt>\` — Execute a prompt in AGY (maintains context in thread)\n` +
        `• \`${prefix} new\` or \`${prefix} reset\` — Start a fresh conversation\n` +
        `• \`${prefix} status\` — View active session info and bridge status\n` +
        `• \`${prefix} help\` — Show this help message\n\n` +
        `*You can also tag <@${client.user?.id}> or create threads under #${targetChannelName} for isolated conversations.*`
      );
      return;
    }

    if (lowerPrompt === 'status') {
      const activeId = sessionMap.get(targetChannel.id) || '(No active session)';
      await (targetChannel as any).send(
        `🖥️ **Mainframe Status:**\n` +
        `• **Target Channel:** #${targetChannelName}\n` +
        `• **Active Conversation ID:** \`${activeId}\`\n` +
        `• **AGY Binary:** \`${agyBin}\`\n` +
        `• **Operator:** <@${message.author.id}>\n` +
        `• **Bot Status:** Connected & Ready`
      );
      return;
    }

    if (lowerPrompt === 'new' || lowerPrompt === 'reset') {
      sessionMap.delete(targetChannel.id);
      await (targetChannel as any).send('🔄 **Session Reset**: Next message will begin a brand-new conversation session with AGY.');
      return;
    }

    if (!prompt) {
      await (targetChannel as any).send(`Please provide a prompt after \`${prefix}\`. Example: \`${prefix} what is the current git status?\``);
      return;
    }

    // 8. Check for Deletion / Destructive Intent & Require Confirmation
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

        // Confirmed!
        await interaction.update({
          content: `🗑️ **Deletion Confirmed** by <@${message.author.id}>. Dispatching to AGY...`,
          components: []
        });
      } catch {
        // Timed out after 60s
        await confirmMsg.edit({
          content: `⏳ **Operation Cancelled**: Deletion confirmation timed out after 60 seconds.`,
          components: []
        }).catch(() => {});
        return;
      }
    }

    // 9. Execute AGY Prompt in target thread / channel
    const sessionKey = targetChannel.id;
    const currentConvId = sessionMap.get(sessionKey);

    // Add working reaction indicator to original message
    try {
      await message.react('⚙️');
    } catch {
      // Non-fatal if reaction fails
    }

    // Send typing indicators periodically in targetChannel while AGY thinks and executes
    const typingInterval = setInterval(() => {
      if ('sendTyping' in targetChannel && typeof (targetChannel as any).sendTyping === 'function') {
        (targetChannel as any).sendTyping().catch(() => {});
      }
    }, 7000);

    try {
      if ('sendTyping' in targetChannel && typeof (targetChannel as any).sendTyping === 'function') {
        await (targetChannel as any).sendTyping();
      }

      const result = await runAgyCommand(prompt, currentConvId, agyBin);

      clearInterval(typingInterval);

      if (result.error) {
        try {
          await message.reactions.removeAll();
          await message.react('❌');
        } catch {}
        const safeError = redactSecrets(result.error, config);
        await (targetChannel as any).send(`❌ **AGY Execution Error**:\n\`\`\`text\n${safeError}\n\`\`\``);
        return;
      }

      // Update session conversation ID for context continuity
      if (result.conversationId) {
        sessionMap.set(sessionKey, result.conversationId);
      }

      try {
        await message.reactions.removeAll();
        await message.react('✅');
      } catch {}

      // Format output cleanly for Discord, redact secrets, and split into safe chunks
      const formatted = formatForDiscord(result.response || '(Done with no output)', config);
      const chunks = splitDiscordMessage(formatted, 1900);

      for (const chunk of chunks) {
        await (targetChannel as any).send(chunk);
      }
    } catch (err: any) {
      clearInterval(typingInterval);
      try {
        await message.reactions.removeAll();
        await message.react('❌');
      } catch {}
      const safeErr = redactSecrets(err.message || String(err), config);
      await (targetChannel as any).send(`❌ **Unexpected Error**: ${safeErr}`).catch(() => {});
    }
  });
}
