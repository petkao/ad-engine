// LLM Provider Tests
// These tests use the MockProvider and never call external APIs

const assert = require('assert');
const {
  createProvider,
  createValidatedProvider,
  getDefaultProvider,
  validateProvider,
  MockProvider,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  NvidiaProvider,
  LLMResponseSchema,
  ProviderConfigSchema,
  sanitizeForLog,
  PROVIDERS,
} = require('../llmProvider');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    testsFailed++;
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    testsPassed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    testsFailed++;
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
  }
}

// ─── PROVIDER FACTORY TESTS ──────────────────────────────────

console.log('\n=== Provider Factory Tests ===\n');

test('createProvider creates MockProvider', () => {
  const provider = createProvider('mock');
  assert.strictEqual(provider.getName(), 'mock');
});

test('createProvider creates OpenAIProvider', () => {
  const provider = createProvider({ provider: 'openai', apiKey: 'test-key' });
  assert.strictEqual(provider.getName(), 'openai');
});

test('createProvider creates NvidiaProvider', () => {
  const provider = createProvider({ provider: 'nvidia', apiKey: 'test-key' });
  assert.strictEqual(provider.getName(), 'nvidia');
});

test('createProvider throws for unknown provider', () => {
  assert.throws(() => {
    createProvider('unknown-provider');
  }, /Invalid provider config|Unknown LLM provider/);
});

test('createProvider validates config schema', () => {
  assert.throws(() => {
    createProvider({ provider: 'openai', temperature: 5 }); // Invalid temperature
  }, /Invalid provider config/);
});

test('PROVIDERS registry contains all providers', () => {
  const expected = ['openai', 'anthropic', 'gemini', 'nvidia', 'openai-compatible', 'mock'];
  for (const name of expected) {
    assert.ok(PROVIDERS[name], `Missing provider: ${name}`);
  }
});

// ─── MOCK PROVIDER TESTS ─────────────────────────────────────

console.log('\n=== Mock Provider Tests ===\n');

test('MockProvider validates successfully', () => {
  const mock = new MockProvider();
  const result = mock.validate();
  assert.strictEqual(result.valid, true);
});

test('MockProvider returns configured response', async () => {
  const mock = new MockProvider({
    defaultResponse: { test: 'response', value: 123 },
    delay: 10,
  });

  const response = await mock.generateJSON('system', 'user');
  const parsed = JSON.parse(response.content);

  assert.strictEqual(parsed.test, 'response');
  assert.strictEqual(parsed.value, 123);
});

test('MockProvider tracks call history', async () => {
  const mock = new MockProvider({ delay: 10 });
  mock.clearHistory();

  await mock.generateJSON('system prompt', 'user prompt', { model: 'test-model' });

  const history = mock.getCallHistory();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].systemPromptLength, 13);
  assert.strictEqual(history[0].userPromptLength, 11);
  assert.strictEqual(history[0].options.model, 'test-model');
});

test('MockProvider can simulate failures', async () => {
  const mock = new MockProvider({ delay: 10 });
  mock.setFailure(true, 'Simulated API error');

  let error;
  try {
    await mock.generateJSON('system', 'user');
  } catch (e) {
    error = e;
  }

  assert.ok(error, 'Expected error to be thrown');
  assert.strictEqual(error.message, 'Simulated API error');
});

test('MockProvider response matches LLMResponseSchema', async () => {
  const mock = new MockProvider({
    defaultResponse: { valid: true },
    delay: 10,
  });

  const response = await mock.generateJSON('system', 'user');
  const validation = LLMResponseSchema.safeParse(response);

  assert.strictEqual(validation.success, true);
  assert.strictEqual(response.provider, 'mock');
  assert.ok(response.durationMs >= 0);
});

// ─── PROVIDER VALIDATION TESTS ───────────────────────────────

console.log('\n=== Provider Validation Tests ===\n');

test('OpenAIProvider validation fails without API key', () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const provider = new OpenAIProvider({});
  const result = provider.validate();

  process.env.OPENAI_API_KEY = original;

  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('Missing API key'));
});

test('NvidiaProvider validation fails without API key', () => {
  const originalNvidia = process.env.NVIDIA_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.OPENAI_API_KEY; // Also delete fallback

  const provider = new NvidiaProvider({});
  const result = provider.validate();

  process.env.NVIDIA_API_KEY = originalNvidia;
  process.env.OPENAI_API_KEY = originalOpenAI;

  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('NVIDIA_API_KEY'));
});

test('AnthropicProvider validation fails without API key', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const provider = new AnthropicProvider({});
  const result = provider.validate();

  process.env.ANTHROPIC_API_KEY = original;

  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('ANTHROPIC_API_KEY'));
});

test('GeminiProvider validation fails without API key', () => {
  const original = process.env.GOOGLE_AI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;

  const provider = new GeminiProvider({});
  const result = provider.validate();

  process.env.GOOGLE_AI_API_KEY = original;

  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('GOOGLE_AI_API_KEY'));
});

test('validateProvider throws for invalid provider', () => {
  const provider = new OpenAIProvider({}); // No API key
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  provider.apiKey = null;

  assert.throws(() => {
    validateProvider(provider);
  }, /Configuration error/);

  process.env.OPENAI_API_KEY = originalKey;
});

test('createValidatedProvider throws for invalid config', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  assert.throws(() => {
    createValidatedProvider({ provider: 'anthropic' });
  }, /Configuration error/);

  process.env.ANTHROPIC_API_KEY = original;
});

// ─── CONFIGURATION TESTS ─────────────────────────────────────

console.log('\n=== Configuration Tests ===\n');

test('Provider respects timeout configuration', () => {
  const provider = createProvider({ provider: 'mock', timeout: 30000 });
  assert.strictEqual(provider.timeout, 30000);
});

test('Provider respects maxRetries configuration', () => {
  const provider = createProvider({ provider: 'mock', maxRetries: 5 });
  assert.strictEqual(provider.maxRetries, 5);
});

test('Provider respects temperature configuration', () => {
  const provider = createProvider({ provider: 'mock', temperature: 0.3 });
  assert.strictEqual(provider.temperature, 0.3);
});

test('Provider respects model configuration', () => {
  const provider = createProvider({ provider: 'openai', model: 'gpt-4', apiKey: 'test' });
  assert.strictEqual(provider.model, 'gpt-4');
});

test('NvidiaProvider uses custom baseURL', () => {
  const provider = createProvider({
    provider: 'nvidia',
    baseURL: 'https://custom.api.nvidia.com/v1',
    apiKey: 'test',
  });
  assert.strictEqual(provider.baseURL, 'https://custom.api.nvidia.com/v1');
});

// ─── SANITIZATION TESTS ──────────────────────────────────────

console.log('\n=== Sanitization Tests ===\n');

test('sanitizeForLog truncates long strings', () => {
  const longString = 'a'.repeat(200);
  const result = sanitizeForLog(longString, 100);
  assert.ok(result.length < longString.length);
  assert.ok(result.includes('(200 chars)'));
});

test('sanitizeForLog handles arrays', () => {
  const result = sanitizeForLog([1, 2, 3]);
  assert.strictEqual(result, '[Array(3)]');
});

test('sanitizeForLog handles objects', () => {
  const result = sanitizeForLog({ key: 'value' });
  assert.strictEqual(result, '[Object]');
});

test('sanitizeForLog passes through short strings', () => {
  const result = sanitizeForLog('short', 100);
  assert.strictEqual(result, 'short');
});

// ─── RESPONSE NORMALIZATION TESTS ────────────────────────────

console.log('\n=== Response Normalization Tests ===\n');

test('Response includes provider name', async () => {
  const mock = new MockProvider({ delay: 10 });
  const response = await mock.generateJSON('sys', 'user');
  assert.strictEqual(response.provider, 'mock');
});

test('Response includes duration', async () => {
  const mock = new MockProvider({ delay: 50 });
  const response = await mock.generateJSON('sys', 'user');
  assert.ok(response.durationMs >= 50);
});

test('Response includes usage stats', async () => {
  const mock = new MockProvider({
    defaultResponse: { test: true },
    delay: 10,
  });
  const response = await mock.generateJSON('system prompt here', 'user prompt here');
  assert.ok(response.usage);
  assert.ok(response.usage.promptTokens >= 0);
  assert.ok(response.usage.completionTokens >= 0);
});

// ─── SCHEMA TESTS ────────────────────────────────────────────

console.log('\n=== Schema Tests ===\n');

test('ProviderConfigSchema validates correct config', () => {
  const result = ProviderConfigSchema.safeParse({
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.7,
    timeout: 60000,
    maxRetries: 2,
  });
  assert.strictEqual(result.success, true);
});

test('ProviderConfigSchema rejects invalid provider', () => {
  const result = ProviderConfigSchema.safeParse({
    provider: 'invalid',
  });
  assert.strictEqual(result.success, false);
});

test('ProviderConfigSchema rejects invalid temperature', () => {
  const result = ProviderConfigSchema.safeParse({
    provider: 'openai',
    temperature: 3, // Max is 2
  });
  assert.strictEqual(result.success, false);
});

test('LLMResponseSchema validates correct response', () => {
  const result = LLMResponseSchema.safeParse({
    content: '{"test": true}',
    provider: 'mock',
    durationMs: 100,
    usage: {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    },
  });
  assert.strictEqual(result.success, true);
});

// ─── SUMMARY ─────────────────────────────────────────────────

console.log('\n=== Test Summary ===\n');
console.log(`  Passed: ${testsPassed}`);
console.log(`  Failed: ${testsFailed}`);
console.log(`  Total:  ${testsPassed + testsFailed}\n`);

process.exit(testsFailed > 0 ? 1 : 0);
