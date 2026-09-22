import { execFile } from 'node:child_process';
import { Client, Message, TextBasedChannel } from 'discord.js';
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
 * Filter and format raw output for clean, polished Discord display.
 */
export function formatForDiscord(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // 1. Strip ANSI escape sequences (terminal colors, cursor movements)
  text = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

  // 2. Strip internal system / reasoning tags
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  text = text.replace(/<observation>[\s\S]*?<\/observation>/gi, '');
  text = text.replace(/<context>[\s\S]*?<\/context>/gi, '');
  text = text.replace(/<system>[\s\S]*?<\/system>/gi, '');

  // 3. Prevent accidental mass mentions
  text = text.replace(/@(everyone|here)/g, '@\u200b$1');

  // 4. Convert markdown tables into bulleted lists
  text = convertMarkdownTablesToBullets(text);

  // 5. Demote oversized # and ## headings to ###
  text = text.replace(/^#\s+(.+)$/gm, '### $1');
  text = text.replace(/^##\s+(.+)$/gm, '### $1');

  // 6. Collapse excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
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
      '--output-format',
      'json'
    ];

    if (conversationId) {
      args.push('--conversation', conversationId);
    }

    args.push('-p', prompt);

    execFile(
      agyBin,
      args,
      {
        cwd,
        timeout: 300000, // 5 min timeout
        maxBuffer: 15 * 1024 * 1024,
        env: {
          ...process.env,
          PAGER: 'cat',
          TERM: 'xterm-256color'
        }
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

    // 6. Handle Special Helper Commands
    const lowerPrompt = prompt.toLowerCase();

    if (lowerPrompt === 'help' || lowerPrompt === '--help') {
      await message.reply(
        `🖥️ **Antigravity Mainframe Bridge**\n\n` +
        `**Commands:**\n` +
        `• \`${prefix} <prompt>\` — Execute a prompt in AGY (maintains context)\n` +
        `• \`${prefix} new\` or \`${prefix} reset\` — Start a fresh conversation\n` +
        `• \`${prefix} status\` — View active session info and bridge status\n` +
        `• \`${prefix} help\` — Show this help message\n\n` +
        `*You can also tag <@${client.user?.id}> or create threads under #${targetChannelName} for isolated conversations.*`
      );
      return;
    }

    if (lowerPrompt === 'status') {
      const activeId = sessionMap.get(message.channelId) || '(No active session)';
      await message.reply(
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
      sessionMap.delete(message.channelId);
      await message.reply('🔄 **Session Reset**: Next message will begin a brand-new conversation session with AGY.');
      return;
    }

    if (!prompt) {
      await message.reply(`Please provide a prompt after \`${prefix}\`. Example: \`${prefix} what is the current git status?\``);
      return;
    }

    // 7. Execute AGY Prompt
    const sessionKey = message.channelId;
    const currentConvId = sessionMap.get(sessionKey);

    // Add working reaction indicator
    try {
      await message.react('⚙️');
    } catch {
      // Non-fatal if reaction fails
    }

    // Send typing indicators periodically while AGY thinks and executes
    const typingInterval = setInterval(() => {
      if ('sendTyping' in message.channel && typeof (message.channel as any).sendTyping === 'function') {
        (message.channel as any).sendTyping().catch(() => {});
      }
    }, 7000);

    try {
      if ('sendTyping' in message.channel && typeof (message.channel as any).sendTyping === 'function') {
        await (message.channel as any).sendTyping();
      }

      const result = await runAgyCommand(prompt, currentConvId, agyBin);

      clearInterval(typingInterval);

      if (result.error) {
        try {
          await message.reactions.removeAll();
          await message.react('❌');
        } catch {}
        await message.reply(`❌ **AGY Execution Error**:\n\`\`\`text\n${result.error}\n\`\`\``);
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

      // Format output cleanly for Discord and split into safe chunks
      const formatted = formatForDiscord(result.response || '(Done with no output)');
      const chunks = splitDiscordMessage(formatted, 1900);

      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          await message.reply(chunks[i]);
        } else {
          await (message.channel as any).send(chunks[i]);
        }
      }
    } catch (err: any) {
      clearInterval(typingInterval);
      try {
        await message.reactions.removeAll();
        await message.react('❌');
      } catch {}
      await message.reply(`❌ **Unexpected Error**: ${err.message || String(err)}`);
    }
  });
}
