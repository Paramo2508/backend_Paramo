const { numberFromEnv } = require('./importConfig');

// Base URL of each supported provider. All of them speak the OpenAI chat completions API, so the
// adapter is the same and only these values change (ADR-033, workspace docs/DECISIONS.md).
const PROVIDER_BASE_URLS = {
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1'
};
const DEFAULT_MODELS = { groq: 'openai/gpt-oss-20b', openai: 'gpt-4.1-nano' };

const provider = (process.env.LLM_PROVIDER || 'groq').trim().toLowerCase();

// Language model of the route assistant (PBI-9.2) and its usage limits; every value is explained in
// ADR-033. The key is read here only: it never leaves the backend.
const assistantConfig = {
  provider,
  apiKey: (process.env.LLM_API_KEY || '').trim(),
  baseUrl: (process.env.LLM_BASE_URL || PROVIDER_BASE_URLS[provider] || '').replace(/\/$/, ''),
  model: process.env.LLM_MODEL || DEFAULT_MODELS[provider] || '',
  // gpt-oss reasons before answering; "low" keeps the answer fast and cheap. Empty: not sent (for
  // models that do not reason).
  reasoningEffort: process.env.LLM_REASONING_EFFORT ?? 'low',
  // Reasoning included; the JSON answer itself is ~100 tokens.
  maxTokens: numberFromEnv('LLM_MAX_TOKENS', 500),
  timeoutMs: numberFromEnv('LLM_TIMEOUT_MS', 8000),
  maxMessageLength: numberFromEnv('ASSISTANT_MAX_MESSAGE_LENGTH', 300),
  // Far below the free Groq plan (1,000 requests and 200,000 tokens a day, 8,000 tokens a minute).
  limits: {
    userPerMinute: numberFromEnv('ASSISTANT_USER_PER_MINUTE', 3),
    userPerDay: numberFromEnv('ASSISTANT_USER_PER_DAY', 15),
    globalPerMinute: numberFromEnv('ASSISTANT_GLOBAL_PER_MINUTE', 5),
    globalPerDay: numberFromEnv('ASSISTANT_GLOBAL_PER_DAY', 100)
  }
};

module.exports = { DEFAULT_MODELS, PROVIDER_BASE_URLS, assistantConfig };
