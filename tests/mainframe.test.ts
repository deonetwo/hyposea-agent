import assert from 'node:assert';
import { splitDiscordMessage } from '../src/mainframe.js';

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
  // First chunk must end with ```
  assert.ok(chunks3[0].endsWith('```'), 'First chunk must close code block');
  // Second chunk must open with ```typescript
  assert.ok(chunks3[1].startsWith('```typescript'), 'Second chunk must reopen code block with language');
  console.log('✅ Code blocks correctly closed and reopened across chunks.');

  console.log('\n=====================================================');
  console.log('🎉 ALL MAINFRAME UNIT TESTS PASSED (3/3)');
  console.log('=====================================================\n');
}

runMainframeUnitTests();
