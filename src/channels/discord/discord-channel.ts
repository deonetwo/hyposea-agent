import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  GatewayIntentBits,
  Message,
  Partials,
  RateLimitData,
  TextBasedChannel
} from 'discord.js';
import { Channel, ChannelRef, InboundAttachment, InboundMessage, OutboundMessage } from '../channel.js';
import { AppConfig } from '../../config.js';

export interface DiscordChannelOptions {
  config: AppConfig;
}

export class DiscordChannel implements Channel {
  public readonly name = 'discord';
  private client: Client;
  private config: AppConfig;
  private authorizedUsers: Set<string>;
  private isStarted = false;

  constructor(options: DiscordChannelOptions) {
    this.config = options.config;
    this.authorizedUsers = new Set(this.config.mainframeAuthorizedUsers || []);

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
      ],
      partials: [Partials.Channel, Partials.Message, Partials.User]
    });

    this.client.rest.on('rateLimited', (rateLimitData: RateLimitData) => {
      console.error(`[Discord] ⚠️ REST Rate limit on route: ${rateLimitData.route}`);
    });
  }

  public async start(emit: (msg: InboundMessage) => Promise<void> | void): Promise<void> {
    if (this.isStarted) return;
    if (!this.config.discordToken) {
      throw new Error('DISCORD_BOT_TOKEN is not configured.');
    }

    return new Promise<void>((resolve, reject) => {
      this.client.once('ready', (readyClient) => {
        console.error(`[Discord] Bot connected as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
        this.isStarted = true;
        resolve();
      });

      this.client.on('error', (err) => console.error('[Discord] Client error:', err.message));
      this.client.on('warn', (warning) => console.error('[Discord] Client warning:', warning));

      this.client.on('messageCreate', async (message: Message) => {
        await this.handleMessageCreate(message, emit);
      });

      this.client.login(this.config.discordToken).catch((err) => {
        console.error('[Discord] Login failed:', err.message);
        reject(err);
      });
    });
  }

  private async handleMessageCreate(
    message: Message,
    emit: (msg: InboundMessage) => Promise<void> | void
  ): Promise<void> {
    // 1. Ignore bot messages
    if (message.author.bot) return;

    const rawContent = message.content.trim();
    if (!rawContent) return;

    const isDm = message.channel.isDMBased() || !message.guildId;
    const authorId = message.author.id;

    const rawAttachments: InboundAttachment[] = message.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      contentType: a.contentType || undefined,
      size: a.size
    }));

    // 2. Strict Authorization for Direct Messages (Owner only)
    if (isDm) {
      if (!this.authorizedUsers.has(authorId)) {
        // Silently ignore unauthorized DM messages for privacy & security
        console.warn(`[Discord Security] Ignored unauthorized DM from user ${authorId} (${message.author.username})`);
        return;
      }

      // In DM, strip prefix if user included it, but allow raw prompt without prefix
      const prefix = (this.config.mainframePrefix || '!agy').toLowerCase();
      let prompt = rawContent;
      if (prompt.toLowerCase().startsWith(prefix)) {
        prompt = prompt.slice(prefix.length).trim();
      }

      const inbound: InboundMessage = {
        id: message.id,
        channelId: message.channel.id,
        authorId,
        authorName: message.author.username,
        content: prompt,
        isDm: true,
        isThread: false,
        createdAt: message.createdTimestamp,
        attachments: rawAttachments.length > 0 ? rawAttachments : undefined,
        react: async (emoji: string) => {
          await message.react(emoji).catch(() => {});
        },
        clearReactions: async () => {
          await message.reactions.removeAll().catch(() => {});
        },
        sendTyping: async () => {
          if ('sendTyping' in message.channel && typeof message.channel.sendTyping === 'function') {
            await message.channel.sendTyping().catch(() => {});
          }
        },
        confirmAction: async (promptPreview: string, timeoutMs = 60000): Promise<boolean> => {
          return this.promptConfirmation(message.channel as TextBasedChannel, authorId, promptPreview, timeoutMs);
        }
      };

      await emit(inbound);
      return;
    }

    // 3. Guild Channels Handling
    if (message.guildId && this.config.allowedGuildIds.length > 0 && !this.config.allowedGuildIds.includes(message.guildId)) {
      return;
    }

    const targetChannelName = (this.config.mainframeChannel || 'mainframe-channel').toLowerCase();
    const channel = message.channel;
    const isDirectMainframe = 'name' in channel && Boolean(channel.name && channel.name.toLowerCase() === targetChannelName);
    const isThreadInMainframe = channel.isThread() && Boolean(channel.parent?.name && channel.parent.name.toLowerCase() === targetChannelName);

    if (!isDirectMainframe && !isThreadInMainframe) {
      return;
    }

    const prefix = (this.config.mainframePrefix || '!agy').toLowerCase();
    const botMention = `<@${this.client.user?.id}>`;
    const botNicknameMention = `<@!${this.client.user?.id}>`;

    let prompt = '';
    let isTriggered = false;

    if (rawContent.toLowerCase().startsWith(prefix)) {
      isTriggered = true;
      prompt = rawContent.slice(prefix.length).trim();
    } else if (rawContent.startsWith(botMention)) {
      isTriggered = true;
      prompt = rawContent.slice(botMention.length).trim();
    } else if (rawContent.startsWith(botNicknameMention)) {
      isTriggered = true;
      prompt = rawContent.slice(botNicknameMention.length).trim();
    } else if (isThreadInMainframe) {
      isTriggered = true;
      prompt = rawContent;
    }

    if (!isTriggered) return;

    // Check authorization in guild
    if (!this.authorizedUsers.has(authorId)) {
      await message.reply('⛔ **Access Denied**: You are not authorized to issue commands to the AGY Mainframe.').catch(() => {});
      return;
    }

    const inbound: InboundMessage = {
      id: message.id,
      channelId: message.channel.id,
      guildId: message.guildId || undefined,
      authorId,
      authorName: message.author.username,
      content: prompt,
      isDm: false,
      isThread: channel.isThread(),
      createdAt: message.createdTimestamp,
      attachments: rawAttachments.length > 0 ? rawAttachments : undefined,
      react: async (emoji: string) => {
        await message.react(emoji).catch(() => {});
      },
      clearReactions: async () => {
        await message.reactions.removeAll().catch(() => {});
      },
      sendTyping: async () => {
        if ('sendTyping' in message.channel && typeof message.channel.sendTyping === 'function') {
          await message.channel.sendTyping().catch(() => {});
        }
      },
      confirmAction: async (promptPreview: string, timeoutMs = 60000): Promise<boolean> => {
        return this.promptConfirmation(message.channel as TextBasedChannel, authorId, promptPreview, timeoutMs);
      }
    };

    await emit(inbound);
  }

  private async promptConfirmation(
    channel: TextBasedChannel,
    authorId: string,
    promptPreview: string,
    timeoutMs: number
  ): Promise<boolean> {
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

    const confirmMsg = await (channel as any).send({
      content:
        `⚠️ **Deletion Confirmation Required**\n` +
        `Your prompt contains a deletion or destructive operation request:\n` +
        `> \`${promptPreview}\`\n\n` +
        `Click **Confirm Deletion** to proceed or **Cancel** to abort. *(Auto-cancels in ${Math.round(timeoutMs / 1000)}s)*`,
      components: [actionRow]
    });

    try {
      const interaction = await confirmMsg.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i: any) => i.user.id === authorId,
        time: timeoutMs
      });

      if (interaction.customId === 'cancel_deletion') {
        await interaction.update({
          content: `❌ **Operation Cancelled**: Deletion request was cancelled by <@${authorId}>.`,
          components: []
        });
        return false;
      }

      await interaction.update({
        content: `🗑️ **Deletion Confirmed** by <@${authorId}>. Dispatching to AGY...`,
        components: []
      });
      return true;
    } catch {
      await confirmMsg.edit({
        content: `⏳ **Operation Cancelled**: Deletion confirmation timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        components: []
      }).catch(() => {});
      return false;
    }
  }

  public async send(target: ChannelRef, out: OutboundMessage): Promise<void> {
    try {
      const targetChannel = await this.client.channels.fetch(target.channelId);
      if (targetChannel && 'send' in targetChannel && typeof targetChannel.send === 'function') {
        if (out.files && out.files.length > 0) {
          await targetChannel.send({
            content: out.content || undefined,
            files: out.files
          });
        } else {
          await targetChannel.send(out.content);
        }
      }
    } catch (err: any) {
      console.error(`[Discord] Failed to send message to channel ${target.channelId}:`, err.message);
    }
  }

  public async stop(): Promise<void> {
    if (!this.isStarted) return;
    try {
      await this.client.destroy();
    } catch {}
    this.isStarted = false;
  }
}
