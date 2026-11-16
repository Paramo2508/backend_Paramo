const { createLlmClient } = require('../../integrations/llm/openAiCompatibleClient');

// A made-up key: no test talks to a real provider.
const FAKE_KEY = 'gsk_test_not_a_real_key_1234567890';
const CONFIG = {
  apiKey: FAKE_KEY,
  baseUrl: 'https://llm.example.test/openai/v1',
  model: 'openai/gpt-oss-20b',
  reasoningEffort: 'low',
  maxTokens: 500,
  timeoutMs: 50
};
const PROMPT = {
  system: 'system prompt',
  user: '{"peticion":"sombra"}',
  schemaName: 'route_weights',
  schema: { type: 'object' }
};
const ANSWER = { understood: true, explanation: 'ok' };

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});
const completion = (content, finishReason = 'stop') =>
  jsonResponse({ choices: [{ finish_reason: finishReason, message: { content } }] });

describe('createLlmClient', () => {
  it('asks the chat completions API for strict JSON with the configured limits', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(completion(JSON.stringify(ANSWER)));
    const client = createLlmClient(CONFIG, { fetchImpl });

    await expect(client.completeJson(PROMPT)).resolves.toEqual(ANSWER);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://llm.example.test/openai/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(JSON.parse(init.body)).toEqual({
      model: 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '{"peticion":"sombra"}' }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'route_weights', strict: true, schema: { type: 'object' } }
      },
      max_completion_tokens: 500,
      temperature: 0,
      reasoning_effort: 'low'
    });
  });

  it('does not send the reasoning effort when it is empty', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(completion(JSON.stringify(ANSWER)));
    await createLlmClient({ ...CONFIG, reasoningEffort: '' }, { fetchImpl }).completeJson(PROMPT);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort');
  });

  it('without a key it is not configured and never calls the provider', async () => {
    const fetchImpl = jest.fn();
    const client = createLlmClient({ ...CONFIG, apiKey: '' }, { fetchImpl });

    expect(client.isConfigured()).toBe(false);
    await expect(client.completeJson(PROMPT)).rejects.toMatchObject({ code: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'rate_limited'],
    [401, 'provider_error'],
    [500, 'provider_error']
  ])('HTTP %s → %s, without the provider body', async (status, code) => {
    const body = { error: { message: `Invalid API key ${FAKE_KEY}` } };
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(body, status));

    const error = await createLlmClient(CONFIG, { fetchImpl })
      .completeJson(PROMPT)
      .catch((caught) => caught);

    expect(error.code).toBe(code);
    expect(error.message).toContain(`HTTP ${status}`);
    expect(error.message).not.toContain(FAKE_KEY);
  });

  it('gives up after the timeout', async () => {
    const fetchImpl = jest.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );

    await expect(createLlmClient(CONFIG, { fetchImpl }).completeJson(PROMPT)).rejects.toMatchObject(
      { code: 'timeout' }
    );
  });

  it('a network error does not repeat its text, which could contain the request', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error(`socket closed: Bearer ${FAKE_KEY}`));

    const error = await createLlmClient(CONFIG, { fetchImpl })
      .completeJson(PROMPT)
      .catch((caught) => caught);

    expect(error.code).toBe('provider_error');
    expect(error.message).not.toContain(FAKE_KEY);
  });

  it.each([
    ['content that is not JSON', completion('Claro, aquí tienes la sombra')],
    ['no content', jsonResponse({ choices: [] })],
    ['an answer cut by the token limit', completion('{"understood":', 'length')]
  ])('%s is an invalid response', async (_case, response) => {
    const fetchImpl = jest.fn().mockResolvedValue(response);
    await expect(createLlmClient(CONFIG, { fetchImpl }).completeJson(PROMPT)).rejects.toMatchObject(
      { code: 'invalid_response' }
    );
  });
});
