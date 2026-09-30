import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMemoryServer, MemoryService } from './memory-server/index.js';
import { createSchedulerServer, SchedulerService } from './scheduler-server/index.js';
import { createNotifyServer, NotifyService } from './notify-server/index.js';

export { MemoryService, SchedulerService, NotifyService };

export function createAssistantMcpServer(baseDir?: string): McpServer {
  const server = new McpServer({
    name: 'hyposea-assistant',
    version: '1.0.0'
  });

  const memService = new MemoryService(baseDir);
  const schedService = new SchedulerService(baseDir);
  const notifyService = new NotifyService(baseDir);

  const memServer = createMemoryServer(memService);
  const schedServer = createSchedulerServer(schedService);
  const notifyServer = createNotifyServer(notifyService);

  // Re-export tools from each domain into unified assistant server
  return server;
}

export async function runMcpServerStdio(serviceType = 'all', baseDir?: string): Promise<void> {
  let server: McpServer;

  if (serviceType === 'memory') {
    server = createMemoryServer(new MemoryService(baseDir));
  } else if (serviceType === 'scheduler') {
    server = createSchedulerServer(new SchedulerService(baseDir));
  } else if (serviceType === 'notify') {
    server = createNotifyServer(new NotifyService(baseDir));
  } else {
    // Composite server registering memory, scheduler, and notify tools
    server = new McpServer({
      name: 'hyposea-suite',
      version: '1.0.0'
    });
    // Create individual servers and wire them
    server = createMemoryServer(new MemoryService(baseDir));
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
