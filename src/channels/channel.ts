export interface InboundMessage {
  id: string;
  channelId: string;
  guildId?: string;
  authorId: string;
  authorName: string;
  content: string;
  isDm: boolean;
  isThread: boolean;
  createdAt: number;
  // Optional interaction hooks provided by the channel adapter
  react?: (emoji: string) => Promise<void>;
  clearReactions?: () => Promise<void>;
  sendTyping?: () => Promise<void>;
  confirmAction?: (promptPreview: string, timeoutMs?: number) => Promise<boolean>;
}

export interface OutboundMessage {
  content: string;
  replyToId?: string;
}

export interface ChannelRef {
  channelId: string;
  userId?: string;
}

export interface Channel {
  name: string;
  start(emit: (msg: InboundMessage) => Promise<void> | void): Promise<void>;
  send(target: ChannelRef, out: OutboundMessage): Promise<void>;
  stop(): Promise<void>;
}
