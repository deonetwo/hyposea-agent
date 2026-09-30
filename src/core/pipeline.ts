import { AppConfig } from '../config.js';
import { Channel, InboundMessage } from '../channels/channel.js';
import { EventBus } from './events.js';
import { SessionStore } from './session-store.js';
import { PerKeyQueue } from './queue.js';
import { AgentRunner } from '../runners/runner.js';
import { AgyRunner } from '../runners/agy.js';
import { AuditModule } from '../modules/audit/index.js';
import { GuardModule } from '../modules/guard/index.js';
import {
  formatForDiscord,
  formatQuotaForDiscord,
  redactSecrets,
  splitDiscordMessage
} from '../modules/formatter/index.js';

export interface PipelineOptions {
  channel: Channel;
  runner: AgentRunner;
  store: SessionStore;
  queue: PerKeyQueue;
  bus?: EventBus;
  audit?: AuditModule;
  guard?: GuardModule;
  config: AppConfig;
}

export class Pipeline {
  private channel: Channel;
  private runner: AgentRunner;
  private store: SessionStore;
  private queue: PerKeyQueue;
  private bus: EventBus;
  private audit: AuditModule;
  private guard: GuardModule;
  private config: AppConfig;

  constructor(options: PipelineOptions) {
    this.channel = options.channel;
    this.runner = options.runner;
    this.store = options.store;
    this.queue = options.queue;
    this.config = options.config;
    this.bus = options.bus || new EventBus();
    this.audit = options.audit || new AuditModule({ dbPath: this.config.dbPath });
    this.guard = options.guard || new GuardModule({ allowedDirectories: [this.config.workDir] });

    // Register audit listeners on the event bus
    this.audit.register(this.bus);
  }

  public getEventBus(): EventBus {
    return this.bus;
  }

  public getAuditModule(): AuditModule {
    return this.audit;
  }

  public getGuardModule(): GuardModule {
    return this.guard;
  }

  public async start(): Promise<void> {
    await this.channel.start(async (msg: InboundMessage) => {
      await this.handleInbound(msg);
    });
  }

  public async handleInbound(msg: InboundMessage): Promise<void> {
    await this.bus.emit('message.in', { message: msg });

    const sessionKey = msg.isDm
      ? `dm-${msg.authorId}`
      : msg.isThread
      ? msg.channelId
      : `main-${msg.channelId}`;

    const prompt = msg.content.trim();
    const lowerPrompt = prompt.toLowerCase();
    const prefix = (this.config.mainframePrefix || '!agy').toLowerCase();

    // 1. Command Router: 'stop'
    if (lowerPrompt === 'stop' || lowerPrompt === 'abort' || lowerPrompt === 'cancel') {
      if (this.queue.isBusy(sessionKey)) {
        this.queue.abort(sessionKey);
        await this.bus.emit('run.aborted', { message: msg, sessionKey, reason: 'User invoked stop command' });
        if (msg.react) await msg.react('🛑');
        await this.sendResponse(msg.channelId, '🛑 **Execution Aborted**: The active AGY process for this session has been cancelled. (Session context preserved).');
      } else {
        await this.sendResponse(msg.channelId, 'ℹ️ No active AGY execution is currently running in this session.');
      }
      return;
    }

    // 2. Command Router: 'help'
    if (lowerPrompt === 'help' || lowerPrompt === '--help') {
      await this.sendResponse(
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

    // 3. Command Router: 'status'
    if (lowerPrompt === 'status') {
      const session = this.store.get(sessionKey);
      const activeId = session?.conversationId || '(No active conversation yet)';
      const msgCount = session?.messageCount || 0;
      await this.sendResponse(
        msg.channelId,
        `🖥️ **Mainframe Status:**\n` +
        `• **Target Channel:** #${this.config.mainframeChannel}\n` +
        `• **Session Mode:** ${msg.isDm ? '💬 Private Direct Message (DM)' : msg.isThread ? '🧵 Thread Session' : '📌 Primary Persistent Session'}\n` +
        `• **Active Conversation ID:** \`${activeId}\`\n` +
        `• **Messages in Session:** ${msgCount}\n` +
        `• **Working Directory:** \`${this.config.workDir}\`\n` +
        `• **AGY Binary:** \`${this.config.agyBinPath}\`\n` +
        `• **Operator:** <@${msg.authorId}> (${msg.authorName})\n` +
        `• **Queue Busy:** ${this.queue.isBusy(sessionKey) ? '⏳ Yes' : '🟢 Idle'}`
      );
      return;
    }

    // 4. Command Router: 'reset' / 'new'
    if (lowerPrompt === 'reset' || lowerPrompt === 'new') {
      this.store.delete(sessionKey);
      await this.sendResponse(msg.channelId, '🔄 **Session Reset**: Your next message will begin a brand-new conversation session with AGY.');
      return;
    }

    // 5. Command Router: 'quota'
    if (this.isModelQuotaCommand(prompt)) {
      await this.handleQuotaCommand(msg, prompt);
      return;
    }

    if (!prompt) {
      await this.sendResponse(msg.channelId, `Please provide a prompt after \`${prefix}\`. Example: \`${prefix} what is the current git status?\``);
      return;
    }

    // 6. Safety Guard: Check dangerous operations / directory boundaries
    const guardCheck = this.guard.evaluate(prompt, this.config.workDir);
    if (guardCheck.requiresConfirmation && !guardCheck.isBypassed) {
      if (msg.confirmAction) {
        const confirmed = await msg.confirmAction(prompt);
        if (!confirmed) {
          return;
        }
      }
    }

    // 7. Enqueue AGY execution in per-session FIFO queue
    if (msg.react) await msg.react('⚙️');

    await this.queue.enqueue(sessionKey, async (signal: AbortSignal) => {
      const currentConvId = this.store.getConversationId(sessionKey) || undefined;
      const startTime = Date.now();

      await this.bus.emit('run.before', {
        message: msg,
        sessionKey,
        prompt,
        conversationId: currentConvId
      });

      const typingInterval = setInterval(() => {
        if (msg.sendTyping) msg.sendTyping().catch(() => {});
      }, 7000);

      try {
        if (msg.sendTyping) await msg.sendTyping().catch(() => {});

        const sessionPrompt = currentConvId
          ? prompt
          : `[Context: Active Discord session in #${this.config.mainframeChannel}. Strictly adhere to discord-display skill guidelines: use ### headers, emoji bullets, no markdown tables, concise direct tone]\n\n${prompt}`;

        const result = await this.runner.run({
          prompt: sessionPrompt,
          sessionId: currentConvId,
          cwd: this.config.workDir,
          signal
        });

        clearInterval(typingInterval);
        const durationMs = Date.now() - startTime;

        if (result.aborted) {
          await this.bus.emit('run.aborted', { message: msg, sessionKey, reason: 'Signal aborted' });
          if (msg.clearReactions) await msg.clearReactions().catch(() => {});
          if (msg.react) await msg.react('🛑').catch(() => {});
          return;
        }

        if (result.error) {
          await this.bus.emit('run.error', { message: msg, sessionKey, error: result.error, durationMs });
          if (msg.clearReactions) await msg.clearReactions().catch(() => {});
          if (msg.react) await msg.react('❌').catch(() => {});
          const safeError = redactSecrets(result.error, this.config);
          await this.sendResponse(msg.channelId, `❌ **AGY Execution Error**:\n\`\`\`text\n${safeError}\n\`\`\``);
          return;
        }

        // Save conversation ID to SQLite
        if (result.conversationId) {
          this.store.set(sessionKey, result.conversationId, {
            channelId: msg.channelId,
            isDm: msg.isDm,
            isThread: msg.isThread,
            authorId: msg.authorId
          });
        }

        await this.bus.emit('run.after', {
          message: msg,
          sessionKey,
          prompt,
          result,
          durationMs
        });

        if (msg.clearReactions) await msg.clearReactions().catch(() => {});
        if (msg.react) await msg.react('✅').catch(() => {});

        const formatted = formatForDiscord(result.response || '(Done with no output)', this.config);
        await this.sendResponse(msg.channelId, formatted);
      } catch (err: any) {
        clearInterval(typingInterval);
        const durationMs = Date.now() - startTime;
        await this.bus.emit('run.error', { message: msg, sessionKey, error: err.message || String(err), durationMs });

        if (msg.clearReactions) await msg.clearReactions().catch(() => {});
        if (msg.react) await msg.react('❌').catch(() => {});
        const safeErr = redactSecrets(err.message || String(err), this.config);
        await this.sendResponse(msg.channelId, `❌ **Unexpected Error**: ${safeErr}`);
      }
    });
  }

  private async handleQuotaCommand(msg: InboundMessage, prompt: string): Promise<void> {
    try {
      if (msg.react) await msg.react('📊');
      if (msg.sendTyping) await msg.sendTyping();

      const isRaw = /(--json|-j|--raw|-r)\b/i.test(prompt);

      let quotaResult;
      if (this.runner instanceof AgyRunner) {
        quotaResult = await this.runner.fetchQuota(this.config.workDir);
      } else {
        const fallback = new AgyRunner({ binPath: this.config.agyBinPath, defaultCwd: this.config.workDir });
        quotaResult = await fallback.fetchQuota(this.config.workDir);
      }

      if (!quotaResult.success) {
        if (msg.clearReactions) await msg.clearReactions();
        if (msg.react) await msg.react('❌');
        const safeErr = redactSecrets(quotaResult.error || 'Failed to query model quota', this.config);
        await this.sendResponse(msg.channelId, `❌ **Failed to retrieve model quota**:\n\`\`\`text\n${safeErr}\n\`\`\``);
        return;
      }

      if (msg.clearReactions) await msg.clearReactions();
      if (msg.react) await msg.react('✅');

      if (isRaw) {
        const payload = quotaResult.data ? JSON.stringify(quotaResult.data, null, 2) : (quotaResult.rawText || '{}');
        await this.sendResponse(msg.channelId, `### 📊 Model Quota (Raw Data)\n\`\`\`json\n${payload}\n\`\`\``);
        return;
      }

      let messageToSend = '';
      if (quotaResult.data && quotaResult.data.groups && quotaResult.data.groups.length > 0) {
        messageToSend = formatQuotaForDiscord(quotaResult.data);
      } else if (quotaResult.rawText) {
        messageToSend = formatForDiscord(quotaResult.rawText, this.config);
      } else {
        messageToSend = '• **Model Quota:** No quota information available.';
      }

      await this.sendResponse(msg.channelId, messageToSend);
    } catch (quotaErr: any) {
      if (msg.clearReactions) await msg.clearReactions();
      if (msg.react) await msg.react('❌');
      const safeErr = redactSecrets(quotaErr.message || String(quotaErr), this.config);
      await this.sendResponse(msg.channelId, `❌ **Unexpected Error**: ${safeErr}`);
    }
  }

  private isModelQuotaCommand(prompt: string): boolean {
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

  private async sendResponse(channelId: string, text: string): Promise<void> {
    const chunks = splitDiscordMessage(text, 1900);
    for (const chunk of chunks) {
      await this.channel.send({ channelId }, { content: chunk });
    }
  }
}
