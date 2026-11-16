const { assistantConfig } = require('../../config/assistantConfig');
const { createLlmClient } = require('./openAiCompatibleClient');

// The client of the provider configured in .env (LLM_PROVIDER, LLM_API_KEY, LLM_MODEL…, ADR-033).
const llmClient = createLlmClient(assistantConfig);

module.exports = { llmClient };
