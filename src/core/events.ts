import { InboundMessage, ChannelRef } from '../channels/channel.js';
import { RunResult } from './types.js';

export interface EventMap {
  'message.in': {
    message: InboundMessage;
  };
  'run.before': {
    message: InboundMessage;
    sessionKey: string;
    prompt: string;
    conversationId?: string;
  };
  'run.after': {
    message: InboundMessage;
    sessionKey: string;
    prompt: string;
    result: RunResult;
    durationMs: number;
  };
  'run.aborted': {
    message: InboundMessage;
    sessionKey: string;
    reason?: string;
  };
  'run.error': {
    message: InboundMessage;
    sessionKey: string;
    error: string;
    durationMs: number;
  };
  'job.due': {
    jobId: string;
    task: string;
    target: ChannelRef;
    metadata?: Record<string, any>;
  };
}

export type EventHandler<T> = (data: T) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<keyof EventMap, Set<EventHandler<any>>>();

  public on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler);

    // Return unbind function
    return () => {
      set.delete(handler);
    };
  }

  public async emit<K extends keyof EventMap>(event: K, data: EventMap[K]): Promise<void> {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;

    for (const handler of Array.from(set)) {
      try {
        await handler(data);
      } catch (err) {
        console.error(`[EventBus] Error in handler for event "${String(event)}":`, err);
      }
    }
  }

  public clear(): void {
    this.handlers.clear();
  }
}
