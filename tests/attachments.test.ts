import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AttachmentManager } from '../src/modules/attachments/index.js';
import { Pipeline } from '../src/core/pipeline.js';
import { SessionStore } from '../src/core/session-store.js';
import { PerKeyQueue } from '../src/core/queue.js';
import { AgentRunner, RunResult } from '../src/runners/runner.js';
import { Channel, ChannelRef, InboundMessage, OutboundMessage } from '../src/channels/channel.js';
import { AppConfig } from '../src/config.js';

describe('AttachmentManager', () => {
  const tmpDir = path.join(os.tmpdir(), `hyposea-att-test-${Date.now()}`);

  test('enrichPrompt appends local attachment paths to user prompt', () => {
    const manager = new AttachmentManager({ workDir: tmpDir });
    const enriched = manager.enrichPrompt('Please analyze this log file', [
      '/tmp/test-log.txt',
      '/tmp/report.pdf'
    ]);

    assert.ok(enriched.includes('Please analyze this log file'));
    assert.ok(enriched.includes('• test-log.txt: `/tmp/test-log.txt`'));
    assert.ok(enriched.includes('• report.pdf: `/tmp/report.pdf`'));
    assert.ok(enriched.includes('Inbound User Attachments Available on Disk'));
  });

  test('enrichPrompt returns unchanged prompt when list is empty', () => {
    const manager = new AttachmentManager({ workDir: tmpDir });
    const prompt = 'Hello AGY';
    assert.strictEqual(manager.enrichPrompt(prompt, []), prompt);
  });

  test('detectOutboundAttachments identifies existing files and strips markers', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const sampleFile1 = path.join(tmpDir, 'output.png');
    const sampleFile2 = path.join(tmpDir, 'chart.svg');
    fs.writeFileSync(sampleFile1, 'fake png data');
    fs.writeFileSync(sampleFile2, 'fake svg data');

    const manager = new AttachmentManager({ workDir: tmpDir });

    const rawResponse = 
      `Here is the generated chart:\n` +
      `[attachment: ${sampleFile1}]\n` +
      `And here is the vector version:\n` +
      `<attachment>${sampleFile2}</attachment>\n` +
      `Hope this helps!`;

    const result = manager.detectOutboundAttachments(rawResponse);

    assert.strictEqual(result.files.length, 2);
    assert.ok(result.files.includes(sampleFile1));
    assert.ok(result.files.includes(sampleFile2));
    assert.ok(!result.cleanedResponse.includes('[attachment:'));
    assert.ok(!result.cleanedResponse.includes('<attachment>'));
    assert.ok(result.cleanedResponse.includes('Here is the generated chart:'));
    assert.ok(result.cleanedResponse.includes('Hope this helps!'));
  });

  test('detectOutboundAttachments ignores non-existent files', () => {
    const manager = new AttachmentManager({ workDir: tmpDir });
    const nonExistent = path.join(tmpDir, 'ghost-file.txt');
    const response = `Check this file: [attachment: ${nonExistent}]`;

    const result = manager.detectOutboundAttachments(response);
    assert.strictEqual(result.files.length, 0);
  });

  test('cleanup removes turn directory', () => {
    const manager = new AttachmentManager({ workDir: tmpDir });
    const turnId = 'turn-test-123';
    const turnDir = path.join(tmpDir, '.hyposea-attachments', turnId);
    fs.mkdirSync(turnDir, { recursive: true });
    fs.writeFileSync(path.join(turnDir, 'temp.txt'), 'data');

    assert.ok(fs.existsSync(turnDir));
    manager.cleanup(turnId);
    assert.ok(!fs.existsSync(turnDir));

    // Cleanup top-level test directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('pipeline integrates inbound and outbound attachments end-to-end', async () => {
    const testDir = path.join(os.tmpdir(), `hyposea-pipe-att-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    const generatedFile = path.join(testDir, 'generated-report.txt');
    fs.writeFileSync(generatedFile, 'Report content');

    class MockChannel implements Channel {
      public name = 'mock';
      public sent: { target: ChannelRef; out: OutboundMessage }[] = [];
      async start() {}
      async send(target: ChannelRef, out: OutboundMessage) {
        this.sent.push({ target, out });
      }
      async stop() {}
    }

    class MockRunner implements AgentRunner {
      public lastPrompt = '';
      async run(req: { prompt: string }): Promise<RunResult> {
        this.lastPrompt = req.prompt;
        return {
          response: `Here is your document:\n[send_file: ${generatedFile}]`,
          conversationId: 'conv-att-test'
        };
      }
      async probe() {
        return { status: 'ok' as const, reason: 'Mock' };
      }
    }

    const channel = new MockChannel();
    const runner = new MockRunner();
    const dbPath = path.join(testDir, 'test.db');
    const store = new SessionStore({ dbPath });
    const queue = new PerKeyQueue();

    const config: AppConfig = {
      discordToken: 'test-token',
      mainframeChannel: 'mainframe-channel',
      mainframePrefix: '!agy',
      mainframeEnabled: true,
      allowedGuildIds: [],
      mainframeAuthorizedUsers: ['user-1'],
      agyBinPath: '/bin/echo',
      workDir: testDir,
      dbPath,
      skipPermissions: true,
      dataDir: testDir
    };

    const pipeline = new Pipeline({
      channel,
      runner,
      store,
      queue,
      config
    });

    const inbound: InboundMessage = {
      id: 'msg-turn-456',
      channelId: 'chan-1',
      authorId: 'user-1',
      authorName: 'Tester',
      content: 'Generate me a report please',
      isDm: false,
      isThread: false,
      createdAt: Date.now()
    };

    await pipeline.handleInbound(inbound);

    // Verify outbound response has attached file
    assert.strictEqual(channel.sent.length, 1);
    const sentMsg = channel.sent[0].out;
    assert.ok(sentMsg.files && sentMsg.files.length === 1);
    assert.strictEqual(sentMsg.files[0], generatedFile);
    assert.ok(sentMsg.content.includes('Here is your document:'));
    assert.ok(!sentMsg.content.includes('[send_file:'));

    // Teardown
    store.close();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });
});
