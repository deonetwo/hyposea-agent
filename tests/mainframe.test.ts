import assert from 'node:assert';
import {
  convertMarkdownTablesToBullets,
  formatForDiscord,
  getSanitizedEnvironment,
  hasExplicitConfirmationFlag,
  isDeletionIntent,
  redactSecrets,
  splitDiscordMessage
} from '../src/mainframe.js';

function runMainframeUnitTests() {
  console.log('\n--- Running Mainframe Unit Tests ---\n');

  // Test 1: Short message doesn't split
  console.log('Test 1: Short message handling');
  const short = 'Hello world from AGY!';
  const chunks1 = splitDiscordMessage(short, 1900);
  assert.strictEqual(chunks1.length, 1);
  assert.strictEqual(chunks1[0], short);
  console.log('✅ Short message remains 1 chunk.');

  // Test 2: Message exceeding maxLength splits cleanly
  console.log('\nTest 2: Basic text chunking');
  const longText = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: ${'a'.repeat(50)}`).join('\n');
  assert.ok(longText.length > 1000);
  const chunks2 = splitDiscordMessage(longText, 500);
  assert.ok(chunks2.length > 1);
  for (const chunk of chunks2) {
    assert.ok(chunk.length <= 600, `Chunk length ${chunk.length} should be reasonably bounded`);
  }
  console.log(`✅ Text successfully split into ${chunks2.length} bounded chunks.`);

  // Test 3: Markdown code blocks preserved across chunks
  console.log('\nTest 3: Markdown code block continuity');
  const codeBlockText = '```typescript\n' + Array.from({ length: 40 }, (_, i) => `const val_${i} = ${i};`).join('\n') + '\n```';
  const chunks3 = splitDiscordMessage(codeBlockText, 300);
  assert.ok(chunks3.length > 1);
  assert.ok(chunks3[0].endsWith('```'), 'First chunk must close code block');
  assert.ok(chunks3[1].startsWith('```typescript'), 'Second chunk must reopen code block with language');
  console.log('✅ Code blocks correctly closed and reopened across chunks.');

  // Test 4: ANSI escape code stripping
  console.log('\nTest 4: ANSI escape sequence stripping');
  const ansiInput = '\u001b[32mSuccess:\u001b[0m All tests passed \u001b[1;34m[OK]\u001b[0m';
  const cleanAnsi = formatForDiscord(ansiInput);
  assert.strictEqual(cleanAnsi, 'Success: All tests passed [OK]');
  console.log('✅ ANSI color and control codes stripped cleanly.');

  // Test 5: Table conversion to bullets
  console.log('\nTest 5: Markdown table conversion to clean bullets');
  const tableInput = 
`| Feature | Status | Details |
| :--- | :--- | :--- |
| Auth | Done | Token validated |
| Bridge | Live | Running on port 3000 |`;

  const converted = convertMarkdownTablesToBullets(tableInput);
  assert.ok(converted.includes('• **Feature:** Auth • **Status:** Done • **Details:** Token validated'));
  assert.ok(converted.includes('• **Feature:** Bridge • **Status:** Live • **Details:** Running on port 3000'));
  console.log('✅ Markdown tables converted to readable bulleted list.');

  // Test 6: Tables inside code blocks are preserved verbatim
  console.log('\nTest 6: Tables inside code blocks preserved');
  const tableInCode = 
`Here is the table code:
\`\`\`markdown
| Col1 | Col2 |
| --- | --- |
| A | B |
\`\`\``;
  const preserved = convertMarkdownTablesToBullets(tableInCode);
  assert.ok(preserved.includes('| Col1 | Col2 |'), 'Code block content must remain untouched');
  console.log('✅ Code block tables preserved.');

  // Test 7: Header demotion and mention safety
  console.log('\nTest 7: Header demotion and mention protection');
  const rawMarkdown = '# Huge Title\n## Subtitle\nWarning @everyone and @here';
  const formatted = formatForDiscord(rawMarkdown);
  assert.ok(formatted.includes('### Huge Title'), 'H1 should be demoted to H3');
  assert.ok(formatted.includes('### Subtitle'), 'H2 should be demoted to H3');
  assert.ok(formatted.includes('@\u200beveryone'), '@everyone should be zero-width escaped');
  assert.ok(formatted.includes('@\u200bhere'), '@here should be zero-width escaped');
  console.log('✅ Headers demoted and mass mentions escaped.');

  // Test 8: Deletion intent detection
  console.log('\nTest 8: Deletion intent detection (including clear, clean, flush, prune, empty)');
  assert.strictEqual(isDeletionIntent('delete the temp file'), true);
  assert.strictEqual(isDeletionIntent('rm -rf node_modules'), true);
  assert.strictEqual(isDeletionIntent('remove old channel'), true);
  assert.strictEqual(isDeletionIntent('drop database test'), true);
  assert.strictEqual(isDeletionIntent('purge messages from yesterday'), true);
  assert.strictEqual(isDeletionIntent('wipe test artifacts'), true);
  assert.strictEqual(isDeletionIntent('clear cache now'), true);
  assert.strictEqual(isDeletionIntent('clean build directory'), true);
  assert.strictEqual(isDeletionIntent('flush redis database'), true);
  assert.strictEqual(isDeletionIntent('prune old containers'), true);
  assert.strictEqual(isDeletionIntent('empty logs folder'), true);
  assert.strictEqual(isDeletionIntent('show current git status'), false);
  assert.strictEqual(isDeletionIntent('create a new file called app.ts'), false);
  console.log('✅ Accurately detected all deletion/destructive/clear prompts.');

  // Test 9: Explicit confirmation flags
  console.log('\nTest 9: Explicit confirmation flag detection');
  assert.strictEqual(hasExplicitConfirmationFlag('rm test.txt --force'), true);
  assert.strictEqual(hasExplicitConfirmationFlag('delete logs -f'), true);
  assert.strictEqual(hasExplicitConfirmationFlag('rm -rf build --yes'), true);
  assert.strictEqual(hasExplicitConfirmationFlag('drop table -y'), true);
  assert.strictEqual(hasExplicitConfirmationFlag('clear cache --confirm'), true);
  assert.strictEqual(hasExplicitConfirmationFlag('delete file.txt'), false);
  console.log('✅ Accurately detected explicit bypass flags.');

  // Test 10: Secret and token redaction
  console.log('\nTest 10: Secret and credential redaction');
  const mockConfig = {
    discordToken: 'MTE4NjIzNDU2Nzg5MDEyMzQ1Ng.G1xYzA.sampleFakeTokenForTestingOnly12345678',
    authToken: 'c3fedb82a3c990263f6eb73f1d3e8e19',
    allowedGuildIds: [],
    port: 3000,
    host: '127.0.0.1',
    requireConfirmation: true,
    maxMessageHistory: 100
  };
  const sensitiveOutput = 
    `Connected with bot token MTE4NjIzNDU2Nzg5MDEyMzQ1Ng.G1xYzA.sampleFakeTokenForTestingOnly12345678 and auth token c3fedb82a3c990263f6eb73f1d3e8e19. ` +
    `GitHub PAT: github_pat_TEST_TOKEN_FOR_UNIT_TESTING_PURPOSES_ONLY_000000000000000000000000000000000000000000000000000 ` +
    `Authorization: Bearer secret_bearer_token_1234567890`;

  const scrubbed = redactSecrets(sensitiveOutput, mockConfig);
  assert.ok(!scrubbed.includes('c3fedb82a3c990263f6eb73f1d3e8e19'), 'MCP Auth token must be redacted');
  assert.ok(!scrubbed.includes('github_pat_TEST_TOKEN_FOR_UNIT_TESTING'), 'GitHub PAT must be redacted');
  assert.ok(!scrubbed.includes('secret_bearer_token_1234567890'), 'Bearer token must be redacted');
  assert.ok(scrubbed.includes('[REDACTED_BOT_TOKEN]'), 'Must replace bot token with placeholder');
  assert.ok(scrubbed.includes('[REDACTED_MCP_TOKEN]'), 'Must replace auth token with placeholder');
  assert.ok(scrubbed.includes('[REDACTED_GITHUB_PAT]'), 'Must replace GitHub PAT with placeholder');

  // Verify formatForDiscord also executes redaction
  const formattedWithSecrets = formatForDiscord(sensitiveOutput, mockConfig);
  assert.ok(!formattedWithSecrets.includes('c3fedb82a3c990263f6eb73f1d3e8e19'));
  console.log('✅ Secrets, tokens, and credentials securely redacted.');

  // Test 11: Child process sanitized environment
  console.log('\nTest 11: Child process sanitized environment');
  process.env.DISCORD_BOT_TOKEN = 'mock_bot_token';
  process.env.MCP_AUTH_TOKEN = 'mock_mcp_token';
  process.env.GITHUB_PAT = 'mock_github_pat';
  process.env.CUSTOM_SECRET_KEY = 'super_secret';
  process.env.DATABASE_PASSWORD = 'secret_password';

  const cleanEnv = getSanitizedEnvironment();
  assert.strictEqual(cleanEnv.DISCORD_BOT_TOKEN, undefined, 'DISCORD_BOT_TOKEN must not leak to child process');
  assert.strictEqual(cleanEnv.MCP_AUTH_TOKEN, undefined, 'MCP_AUTH_TOKEN must not leak to child process');
  assert.strictEqual(cleanEnv.GITHUB_PAT, undefined, 'GITHUB_PAT must not leak to child process');
  assert.strictEqual(cleanEnv.CUSTOM_SECRET_KEY, undefined, 'Keys with "secret" must be dropped');
  assert.strictEqual(cleanEnv.DATABASE_PASSWORD, undefined, 'Keys with "password" must be dropped');
  assert.strictEqual(cleanEnv.PAGER, 'cat', 'PAGER must be configured');
  assert.strictEqual(cleanEnv.TERM, 'xterm-256color', 'TERM must be configured');
  console.log('✅ Child process environment stripped of all sensitive keys and credentials.');

  console.log('\n=====================================================');
  console.log('🎉 ALL MAINFRAME UNIT TESTS PASSED (11/11)');
  console.log('=====================================================\n');
}

runMainframeUnitTests();
