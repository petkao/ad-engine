// LLM Provider Abstraction
// Generic interface for LLM providers with validation, timeouts, and normalized responses

const { z } = require('zod');

// ─── RESPONSE SCHEMA ─────────────────────────────────────────
// All providers must return responses matching this contract

const LLMResponseSchema = z.object({
  content: z.string(),
  usage: z.object({
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  }).optional(),
  model: z.string().optional(),
  provider: z.string(),
  durationMs: z.number().nonnegative().optional(),
});

// ─── CONFIGURATION SCHEMA ────────────────────────────────────

const ProviderConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'gemini', 'nvidia', 'openai-compatible', 'mock']).default('openai'),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  timeout: z.number().int().positive().default(60000), // 60s default
  maxRetries: z.number().int().nonnegative().default(2),
  baseURL: z.string().url().optional(), // For OpenAI-compatible endpoints
});

// ─── LOGGING UTILITIES ───────────────────────────────────────
// Never log API keys, full prompts, or sensitive data

function sanitizeForLog(obj, maxLength = 100) {
  if (typeof obj === 'string') {
    if (obj.length > maxLength) {
      return obj.substring(0, maxLength) + `... (${obj.length} chars)`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return `[Array(${obj.length})]`;
  }
  if (obj && typeof obj === 'object') {
    return '[Object]';
  }
  return obj;
}

function logProviderCall(provider, action, details = {}) {
  const safeDetails = {};
  for (const [key, value] of Object.entries(details)) {
    // Never log these fields
    if (['apiKey', 'prompt', 'content', 'systemPrompt', 'userPrompt'].includes(key)) {
      continue;
    }
    safeDetails[key] = sanitizeForLog(value);
  }
  console.log(`[LLM:${provider}] ${action}`, Object.keys(safeDetails).length ? safeDetails : '');
}

// ─── BASE PROVIDER CLASS ─────────────────────────────────────

class LLMProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = 'base';
    this.timeout = config.timeout || 60000;
    this.maxRetries = config.maxRetries ?? 2;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens || 4096;
  }

  /**
   * Generate a completion with JSON response format
   * @param {string} systemPrompt - System instructions
   * @param {string} userPrompt - User message/prompt
   * @param {Object} [options] - Additional options
   * @returns {Promise<z.infer<typeof LLMResponseSchema>>}
   */
  async generateJSON(systemPrompt, userPrompt, options = {}) {
    throw new Error('generateJSON must be implemented by provider');
  }

  /**
   * Check if the provider is properly configured
   * @returns {{ valid: boolean, error?: string }}
   */
  validate() {
    return { valid: false, error: 'Provider not implemented' };
  }

  /**
   * Get provider name
   * @returns {string}
   */
  getName() {
    return this.name;
  }

  /**
   * Normalize response to standard contract
   * @protected
   */
  _normalizeResponse(content, usage, startTime, model) {
    const response = {
      content: content || '',
      provider: this.name,
      model: model || this.config.model,
      durationMs: Date.now() - startTime,
    };

    if (usage) {
      response.usage = {
        promptTokens: usage.prompt_tokens || usage.input_tokens || usage.promptTokenCount,
        completionTokens: usage.completion_tokens || usage.output_tokens || usage.candidatesTokenCount,
        totalTokens: usage.total_tokens || usage.totalTokenCount ||
          ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)),
      };
    }

    // Validate response matches contract
    const validation = LLMResponseSchema.safeParse(response);
    if (!validation.success) {
      console.error(`[LLM:${this.name}] Response validation failed:`, validation.error.message);
    }

    return response;
  }

  /**
   * Execute with timeout
   * @protected
   */
  async _withTimeout(promise, timeoutMs) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`LLM request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}

// ─── OPENAI-COMPATIBLE BASE PROVIDER ─────────────────────────
// Base class for OpenAI and OpenAI-compatible APIs (NVIDIA NIM, etc.)

class OpenAICompatibleProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.name = config.providerName || 'openai-compatible';
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.model = config.model || 'gpt-4o';
    this.baseURL = config.baseURL; // undefined = default OpenAI
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      try {
        const OpenAI = require('openai');
        const clientConfig = { apiKey: this.apiKey };
        if (this.baseURL) {
          clientConfig.baseURL = this.baseURL;
        }
        this._client = new OpenAI(clientConfig);
      } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
          throw new Error(`OpenAI SDK not installed. Run: npm install openai`);
        }
        throw err;
      }
    }
    return this._client;
  }

  validate() {
    if (!this.apiKey) {
      const envVar = this.name === 'nvidia' ? 'NVIDIA_API_KEY' : 'OPENAI_API_KEY';
      return { valid: false, error: `Missing API key. Set ${envVar} environment variable.` };
    }
    try {
      require.resolve('openai');
    } catch {
      return { valid: false, error: 'OpenAI SDK not installed. Run: npm install openai' };
    }
    return { valid: true };
  }

  async generateJSON(systemPrompt, userPrompt, options = {}) {
    const startTime = Date.now();
    const model = options.model || this.model;
    const temperature = options.temperature ?? this.temperature;
    const timeout = options.timeout || this.timeout;

    logProviderCall(this.name, 'generateJSON', { model, temperature, timeout });

    const client = this._getClient();

    const requestConfig = {
      model,
      temperature,
      max_tokens: options.maxTokens || this.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };

    // OpenAI supports response_format, some compatible APIs may not
    if (!this.baseURL || this.config.supportsResponseFormat !== false) {
      requestConfig.response_format = { type: 'json_object' };
    }

    const response = await this._withTimeout(
      client.chat.completions.create(requestConfig),
      timeout
    );

    const content = response.choices[0]?.message?.content || '';

    logProviderCall(this.name, 'response', {
      model: response.model,
      durationMs: Date.now() - startTime,
      tokens: response.usage?.total_tokens,
    });

    return this._normalizeResponse(content, response.usage, startTime, response.model);
  }
}

// ─── OPENAI PROVIDER ─────────────────────────────────────────

class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(config = {}) {
    super({
      ...config,
      providerName: 'openai',
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      model: config.model || 'gpt-4o',
    });
  }
}

// ─── NVIDIA PROVIDER ─────────────────────────────────────────
// Uses NVIDIA NIM API (OpenAI-compatible endpoint)

class NvidiaProvider extends OpenAICompatibleProvider {
  constructor(config = {}) {
    super({
      ...config,
      providerName: 'nvidia',
      apiKey: config.apiKey || process.env.NVIDIA_API_KEY,
      model: config.model || 'nvidia/llama-3.1-nemotron-70b-instruct',
      baseURL: config.baseURL || 'https://integrate.api.nvidia.com/v1',
      supportsResponseFormat: false, // NVIDIA NIM may not support response_format
    });
  }

  validate() {
    if (!this.apiKey) {
      return { valid: false, error: 'Missing API key. Set NVIDIA_API_KEY environment variable.' };
    }
    try {
      require.resolve('openai');
    } catch {
      return { valid: false, error: 'OpenAI SDK not installed. Run: npm install openai' };
    }
    return { valid: true };
  }
}

// ─── ANTHROPIC PROVIDER ──────────────────────────────────────

class AnthropicProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'anthropic';
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = config.model || 'claude-sonnet-4-20250514';
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        this._client = new Anthropic({ apiKey: this.apiKey });
      } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
          throw new Error(`Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk`);
        }
        throw err;
      }
    }
    return this._client;
  }

  validate() {
    if (!this.apiKey) {
      return { valid: false, error: 'Missing API key. Set ANTHROPIC_API_KEY environment variable.' };
    }
    try {
      require.resolve('@anthropic-ai/sdk');
    } catch {
      return { valid: false, error: 'Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk' };
    }
    return { valid: true };
  }

  async generateJSON(systemPrompt, userPrompt, options = {}) {
    const startTime = Date.now();
    const model = options.model || this.model;
    const temperature = options.temperature ?? this.temperature;
    const timeout = options.timeout || this.timeout;

    logProviderCall(this.name, 'generateJSON', { model, temperature, timeout });

    const client = this._getClient();

    // Anthropic requires explicit JSON instruction
    const jsonSystemPrompt = `${systemPrompt}\n\nIMPORTANT: Respond with valid JSON only. No markdown, no code blocks, no explanation.`;

    const response = await this._withTimeout(
      client.messages.create({
        model,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature,
        system: jsonSystemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      timeout
    );

    const content = response.content[0]?.text || '';

    logProviderCall(this.name, 'response', {
      model: response.model,
      durationMs: Date.now() - startTime,
      tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    });

    return this._normalizeResponse(content, response.usage, startTime, response.model);
  }
}

// ─── GOOGLE GEMINI PROVIDER ──────────────────────────────────

class GeminiProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'gemini';
    this.apiKey = config.apiKey || process.env.GOOGLE_AI_API_KEY;
    this.model = config.model || 'gemini-1.5-pro';
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        this._client = new GoogleGenerativeAI(this.apiKey);
      } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
          throw new Error(`Google AI SDK not installed. Run: npm install @google/generative-ai`);
        }
        throw err;
      }
    }
    return this._client;
  }

  validate() {
    if (!this.apiKey) {
      return { valid: false, error: 'Missing API key. Set GOOGLE_AI_API_KEY environment variable.' };
    }
    try {
      require.resolve('@google/generative-ai');
    } catch {
      return { valid: false, error: 'Google AI SDK not installed. Run: npm install @google/generative-ai' };
    }
    return { valid: true };
  }

  async generateJSON(systemPrompt, userPrompt, options = {}) {
    const startTime = Date.now();
    const model = options.model || this.model;
    const temperature = options.temperature ?? this.temperature;
    const timeout = options.timeout || this.timeout;

    logProviderCall(this.name, 'generateJSON', { model, temperature, timeout });

    const client = this._getClient();

    const generativeModel = client.getGenerativeModel({
      model,
      generationConfig: {
        temperature,
        maxOutputTokens: options.maxTokens || this.maxTokens,
        responseMimeType: 'application/json',
      },
    });

    const result = await this._withTimeout(
      generativeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      }),
      timeout
    );

    const response = result.response;
    const content = response.text();

    logProviderCall(this.name, 'response', {
      model,
      durationMs: Date.now() - startTime,
      tokens: response.usageMetadata?.totalTokenCount,
    });

    return this._normalizeResponse(content, response.usageMetadata, startTime, model);
  }
}

// ─── MOCK PROVIDER ───────────────────────────────────────────
// For testing without calling external APIs

class MockProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'mock';
    this.responses = config.responses || {};
    this.defaultResponse = config.defaultResponse || { mock: true };
    this.delay = config.delay || 100;
    this.shouldFail = config.shouldFail || false;
    this.failureMessage = config.failureMessage || 'Mock failure';
    this._callHistory = [];
  }

  validate() {
    return { valid: true };
  }

  /**
   * Set mock response for next call
   */
  setResponse(response) {
    this.defaultResponse = response;
  }

  /**
   * Set mock to fail on next call
   */
  setFailure(shouldFail, message) {
    this.shouldFail = shouldFail;
    this.failureMessage = message || 'Mock failure';
  }

  /**
   * Get call history for assertions
   */
  getCallHistory() {
    return this._callHistory;
  }

  /**
   * Clear call history
   */
  clearHistory() {
    this._callHistory = [];
  }

  async generateJSON(systemPrompt, userPrompt, options = {}) {
    const startTime = Date.now();

    // Record call (without sensitive data)
    this._callHistory.push({
      timestamp: new Date().toISOString(),
      systemPromptLength: systemPrompt?.length || 0,
      userPromptLength: userPrompt?.length || 0,
      options: { ...options, model: options.model || this.config.model },
    });

    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, this.delay));

    // Simulate failure if configured
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const content = JSON.stringify(this.defaultResponse);

    return this._normalizeResponse(content, {
      prompt_tokens: Math.ceil((systemPrompt?.length || 0) / 4),
      completion_tokens: Math.ceil(content.length / 4),
    }, startTime, 'mock-model');
  }
}

// ─── PROVIDER FACTORY ────────────────────────────────────────

const PROVIDERS = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  gemini: GeminiProvider,
  nvidia: NvidiaProvider,
  'openai-compatible': OpenAICompatibleProvider,
  mock: MockProvider,
};

/**
 * Create an LLM provider based on configuration
 * @param {Object|string} config - Provider config or name
 * @returns {LLMProvider}
 */
function createProvider(config = {}) {
  // Allow passing just a provider name
  if (typeof config === 'string') {
    config = { provider: config };
  }

  // Validate and normalize config
  const parsed = ProviderConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid provider config: ${parsed.error.message}`);
  }

  const normalizedConfig = parsed.data;
  const providerName = normalizedConfig.provider;

  const ProviderClass = PROVIDERS[providerName];
  if (!ProviderClass) {
    throw new Error(`Unknown LLM provider: ${providerName}. Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  return new ProviderClass(normalizedConfig);
}

/**
 * Get the default provider based on environment configuration
 * @returns {LLMProvider}
 */
function getDefaultProvider() {
  const providerName = process.env.LLM_PROVIDER || 'openai';
  const model = process.env.LLM_MODEL;
  const temperature = process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : undefined;
  const timeout = process.env.LLM_TIMEOUT ? parseInt(process.env.LLM_TIMEOUT, 10) : undefined;
  const maxRetries = process.env.LLM_MAX_RETRIES ? parseInt(process.env.LLM_MAX_RETRIES, 10) : undefined;
  const baseURL = process.env.LLM_BASE_URL;

  return createProvider({
    provider: providerName,
    model,
    temperature,
    timeout,
    maxRetries,
    baseURL,
  });
}

/**
 * Validate provider configuration at startup
 * @param {LLMProvider} provider
 * @throws {Error} if provider is not properly configured
 */
function validateProvider(provider) {
  const result = provider.validate();
  if (!result.valid) {
    throw new Error(`[LLM:${provider.getName()}] Configuration error: ${result.error}`);
  }
  logProviderCall(provider.getName(), 'validated', { model: provider.model });
  return true;
}

/**
 * Create and validate a provider in one step
 * @param {Object|string} config
 * @returns {LLMProvider}
 * @throws {Error} if provider is not properly configured
 */
function createValidatedProvider(config = {}) {
  const provider = createProvider(config);
  validateProvider(provider);
  return provider;
}

// ─── EXPORTS ─────────────────────────────────────────────────

module.exports = {
  // Schemas
  LLMResponseSchema,
  ProviderConfigSchema,

  // Base classes (for extension)
  LLMProvider,
  OpenAICompatibleProvider,

  // Provider implementations
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  NvidiaProvider,
  MockProvider,

  // Factory functions
  createProvider,
  createValidatedProvider,
  getDefaultProvider,
  validateProvider,

  // Provider registry (for custom providers)
  PROVIDERS,

  // Utilities
  sanitizeForLog,
};
