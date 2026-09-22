import assert from 'node:assert';
import { convertMarkdownTablesToBullets, formatForDiscord, splitDiscordMessage } from '../src/mainframe.js';

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

  console.log('\n=====================================================');
  console.log('🎉 ALL MAINFRAME UNIT TESTS PASSED (7/7)');
  console.log('=====================================================\n');
}

runMainframeUnitTests();
