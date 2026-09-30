import { AppConfig } from '../../config.js';
import { ModelQuotaData } from '../../core/types.js';

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
