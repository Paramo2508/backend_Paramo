// Adapter for any provider that speaks the OpenAI chat completions API (Groq, OpenAI…), chosen with
// environment variables (ADR-033). It only knows how to ask for a JSON answer that follows a schema;
// what the assistant asks and how the answer is checked belong to the domain.
//
// Errors carry a `code` and a message without the key, the request or the provider's body: they end
// up in the logs.

const LLM_ERROR_CODES = [
  'not_configured',
  'timeout',
  'rate_limited',
  'provider_error',
  'invalid_response'
];

function llmError(code, message) {
  return Object.assign(new Error(message), { name: 'LlmError', code });
}

function isConfigured(config) {
  return Boolean(config.apiKey && config.baseUrl && config.model);
}

function requestBody(config, { system, user, schemaName, schema }) {
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema }
    },
    max_completion_tokens: config.maxTokens,
    temperature: 0
  };
  if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort;
  return body;
}

function answerFrom(data) {
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw llmError('invalid_response', 'The language model ran out of tokens.');
  }
  const content = choice?.message?.content;
  if (typeof content !== 'string') {
    throw llmError('invalid_response', 'The language model returned no content.');
  }
  try {
    return JSON.parse(content);
  } catch {
    throw llmError('invalid_response', 'The language model did not return JSON.');
  }
}

function createLlmClient(config, { fetchImpl = (...args) => fetch(...args) } = {}) {
  async function completeJson(prompt) {
    if (!isConfigured(config))
      throw llmError('not_configured', 'The language model is not set up.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(requestBody(config, prompt)),
        signal: controller.signal
      });
      if (response.status === 429) {
        throw llmError('rate_limited', 'The language model provider is rate limiting (HTTP 429).');
      }
      if (!response.ok) {
        throw llmError(
          'provider_error',
          `The language model provider failed (HTTP ${response.status}).`
        );
      }
      return answerFrom(await response.json());
    } catch (error) {
      if (controller.signal.aborted) {
        throw llmError('timeout', `The language model timed out after ${config.timeoutMs} ms.`);
      }
      if (error.name === 'LlmError') throw error;
      // A network error or a body that is not JSON: its text could repeat the request, so it is
      // not kept.
      throw llmError('provider_error', 'The language model provider could not be reached.');
    } finally {
      clearTimeout(timer);
    }
  }

  return { isConfigured: () => isConfigured(config), completeJson };
}

module.exports = { LLM_ERROR_CODES, createLlmClient, llmError };
