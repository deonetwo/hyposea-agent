import { MemoryService } from '../mcp/memory-server/index.js';

export interface ContextBuilderOptions {
  memoryService?: MemoryService;
  baseDir?: string;
}

export class ContextBuilder {
  private memoryService: MemoryService;

  constructor(options: ContextBuilderOptions = {}) {
    this.memoryService = options.memoryService || new MemoryService(options.baseDir);
  }

  public getMemoryService(): MemoryService {
    return this.memoryService;
  }

  /**
   * Generates initial context preamble containing user preferences and stored memory
   */
  public buildInitialPrompt(userPrompt: string, channelName: string): string {
    const memoryContext = this.memoryService.getContext();

    let preamble = `[Context: Active Discord session in #${channelName}. Strictly adhere to discord-display skill guidelines: use ### headers, emoji bullets, no markdown tables, concise direct tone]`;

    if (memoryContext) {
      preamble += `\n\n[Persistent Assistant Memory]\n${memoryContext}`;
    }

    return `${preamble}\n\n${userPrompt}`;
  }

  /**
   * Records a user/assistant turn into the FTS5 conversation index
   */
  public recordTurn(sessionId: string, role: 'user' | 'assistant', content: string): void {
    this.memoryService.recordTurn(sessionId, role, content);
  }
}
