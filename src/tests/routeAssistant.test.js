const request = require('supertest');

// The whole chain is real (validation, limits, weights, weighted route); only the outside world is
// simulated: the language model, OpenRouteService, Open-Meteo and the PostGIS queries. No test calls
// a real provider.
jest.mock('../api/middleware/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.userId = Number(req.get('x-test-user') || 1);
    next();
  }
}));
jest.mock('../integrations/llm/llmClient', () => ({
  llmClient: { isConfigured: jest.fn(), completeJson: jest.fn() }
}));
jest.mock('../integrations/openRouteService/directionsClient', () => ({
  getAlternativeWalkingRoutes: jest.fn(),
  getFastestWalkingRoute: jest.fn()
}));
jest.mock('../repositories/routeSegmentRepository', () => ({ findSegmentsForRoutes: jest.fn() }));
jest.mock('../services/shadow/exposureService', () => ({ calculateSegmentExposures: jest.fn() }));
jest.mock('../repositories/opennessRepository', () => ({ findOpennessNearPoints: jest.fn() }));
jest.mock('../repositories/vegetationRepository', () => ({ findGreenRatios: jest.fn() }));
jest.mock('../services/weather/weatherService', () => ({ getZaragozaWeather: jest.fn() }));

const { createApp } = require('../app');
const { createLlmClient } = require('../integrations/llm/openAiCompatibleClient');
const { llmClient } = require('../integrations/llm/llmClient');
const {
  getAlternativeWalkingRoutes,
  getFastestWalkingRoute
} = require('../integrations/openRouteService/directionsClient');
const { findOpennessNearPoints } = require('../repositories/opennessRepository');
const { findSegmentsForRoutes } = require('../repositories/routeSegmentRepository');
const { findGreenRatios } = require('../repositories/vegetationRepository');
const { NOTICES, assistantLimiter } = require('../services/routing/routeAssistantService');
const { calculateSegmentExposures } = require('../services/shadow/exposureService');
const { getZaragozaWeather } = require('../services/weather/weatherService');

const NO_WEIGHTS = { shade: 0, sun: 0, wind: 0, vegetation: 0 };
const body = (overrides = {}) => ({
  origin: { lat: 41.65, lng: -0.87 },
  destination: { lat: 41.65, lng: -0.882 },
  date: '2026-07-15',
  time: '13:00',
  timeZone: 'Europe/Madrid',
  message: 'prefiero la sombra aunque tarde más',
  weights: NO_WEIGHTS,
  maxDetourPercentage: 25,
  ...overrides
});

// Fastest: 1000 m to the west, sunny and without green. Alternative: 300 m north, 1000 m west and
// 300 m south, shaded, green and with the first and last pieces across a west wind.
const FASTEST = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-0.87, 41.65],
      [-0.882, 41.65]
    ]
  },
  distance: 1000,
  duration: 600
};
const ALTERNATIVE = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-0.87, 41.65],
      [-0.87, 41.6527],
      [-0.882, 41.6527],
      [-0.882, 41.65]
    ]
  },
  distance: 1600,
  duration: 640
};
const WEATHER = {
  temperature: 31,
  apparentTemperature: 33,
  windSpeed: 40,
  windGusts: 60,
  windDirection: 270,
  time: '2026-07-15T13:00',
  timeZone: 'Europe/Madrid'
};

// What the simulated model answers to each typical request (ADR-033): null for what the request
// does not mention, as the real model does.
const UNCHANGED = { shade: null, sun: null, wind: null, vegetation: null };
const MODEL_ANSWERS = {
  'prefiero la sombra aunque tarde más': {
    understood: true,
    weights: { ...UNCHANGED, shade: 50 },
    maxDetourPercentage: 35,
    explanation: 'He buscado sombra y acepto hasta un 35 % más de tiempo.'
  },
  'evita el viento': {
    understood: true,
    weights: { ...UNCHANGED, wind: 50 },
    maxDetourPercentage: null,
    explanation: 'He puesto el viento al 50 % para evitar el viento de cara.'
  },
  'quiero ir por parques': {
    understood: true,
    weights: { ...UNCHANGED, vegetation: 60 },
    maxDetourPercentage: null,
    explanation: 'He buscado calles con árboles y parques.'
  },
  'lo más rápido': {
    understood: true,
    weights: NO_WEIGHTS,
    maxDetourPercentage: null,
    explanation: 'He quitado todas las preferencias: solo cuenta el tiempo.'
  },
  'cuéntame un chiste': {
    understood: false,
    weights: UNCHANGED,
    maxDetourPercentage: null,
    explanation: ''
  },
  'algo mejor': {
    understood: false,
    weights: UNCHANGED,
    maxDetourPercentage: null,
    explanation: ''
  }
};

const post = (payload, user = 1) =>
  request(createApp()).post('/api/routes/assistant').set('x-test-user', String(user)).send(payload);

const userMessageOf = (call) => JSON.parse(call[0].user);

function jsonFailure(status, message) {
  return async () => ({ ok: false, status, json: async () => ({ error: { message } }) });
}

describe('POST /api/routes/assistant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assistantLimiter.reset();
    llmClient.isConfigured.mockReturnValue(true);
    llmClient.completeJson.mockImplementation(
      async (prompt) => MODEL_ANSWERS[JSON.parse(prompt.user).peticion]
    );
    getZaragozaWeather.mockResolvedValue(WEATHER);
    getFastestWalkingRoute.mockResolvedValue(FASTEST);
    getAlternativeWalkingRoutes.mockResolvedValue([FASTEST, ALTERNATIVE]);
    findOpennessNearPoints.mockImplementation(async (points) => points.map(() => 0));
    findGreenRatios.mockResolvedValue(
      new Map([
        [1, 0],
        [2, 0.9]
      ])
    );
    findSegmentsForRoutes.mockResolvedValue([
      { routeIndex: 0, segmentId: 1, overlapLengthM: 1000 },
      { routeIndex: 1, segmentId: 2, overlapLengthM: 1600 }
    ]);
    calculateSegmentExposures.mockImplementation(async ({ date, time, timeZone }) => ({
      status: 'calculated',
      reference: { localDateTime: `${date}T${time}`, timeZone },
      segments: [
        { segmentId: 1, status: 'available', shadeRatio: 0.1 },
        { segmentId: 2, status: 'available', shadeRatio: 0.8 }
      ]
    }));
  });

  describe('typical requests', () => {
    it('"prefiero la sombra aunque tarde más": seeks shade and recalculates the route', async () => {
      const response = await post(body());

      expect(response.status).toBe(200);
      expect(response.body.assistant).toEqual({
        status: 'applied',
        explanation: 'He buscado sombra y acepto hasta un 35 % más de tiempo.',
        before: { weights: NO_WEIGHTS, maxDetourPercentage: 25 },
        after: { weights: { shade: 50, sun: 0, wind: 0, vegetation: 0 }, maxDetourPercentage: 35 },
        changes: [
          { factor: 'shade', before: 0, after: 50 },
          { factor: 'maxDetourPercentage', before: 25, after: 35 }
        ]
      });
      expect(response.body.comparison).toMatchObject({
        status: 'selected',
        weights: { shade: 50, sun: 0, wind: 0, vegetation: 0 },
        selected: { distance: 1600, exposure: { shadePercentage: 80 } }
      });
    });

    it('"evita el viento": weighs the wind', async () => {
      const response = await post(body({ message: 'evita el viento' }));

      expect(response.body.assistant.changes).toEqual([{ factor: 'wind', before: 0, after: 50 }]);
      expect(response.body.comparison.weights).toEqual({
        shade: 0,
        sun: 0,
        wind: 50,
        vegetation: 0
      });
      expect(response.body.comparison.wind).toMatchObject({ speedKmh: 40, source: 'open-meteo' });
    });

    it('"quiero ir por parques": weighs the green and takes the green alternative', async () => {
      const response = await post(body({ message: 'quiero ir por parques' }));

      expect(response.body.assistant.changes).toEqual([
        { factor: 'vegetation', before: 0, after: 60 }
      ]);
      expect(response.body.comparison).toMatchObject({
        status: 'selected',
        selected: { distance: 1600, vegetation: { greenPercentage: 90 } }
      });
    });

    it('is incremental: with shade 50, "evita el viento" keeps the shade', async () => {
      const shaded = { shade: 50, sun: 0, wind: 0, vegetation: 0 };
      const response = await post(
        body({ message: 'evita el viento', weights: shaded, maxDetourPercentage: 35 })
      );

      expect(response.body.assistant.after).toEqual({
        weights: { shade: 50, sun: 0, wind: 50, vegetation: 0 },
        maxDetourPercentage: 35
      });
      expect(response.body.assistant.changes).toEqual([{ factor: 'wind', before: 0, after: 50 }]);
      expect(response.body.comparison.weights).toEqual({
        shade: 50,
        sun: 0,
        wind: 50,
        vegetation: 0
      });
    });

    it('"lo más rápido": every weight back to 0, only the fastest route', async () => {
      const current = { shade: 50, sun: 0, wind: 30, vegetation: 0 };
      const response = await post(body({ message: 'lo más rápido', weights: current }));

      expect(response.body.assistant.changes).toEqual([
        { factor: 'shade', before: 50, after: 0 },
        { factor: 'wind', before: 30, after: 0 }
      ]);
      expect(response.body.comparison).toMatchObject({ status: 'fastest_only', selected: null });
      expect(getAlternativeWalkingRoutes).not.toHaveBeenCalled();
    });

    it('without a date and time the route is for now in Zaragoza', async () => {
      jest.useFakeTimers({
        now: new Date('2026-07-15T11:00:00Z'),
        doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout']
      });
      try {
        const withoutMoment = body();
        ['date', 'time', 'timeZone'].forEach((field) => delete withoutMoment[field]);
        const response = await post(withoutMoment);

        expect(response.status).toBe(200);
        expect(response.body.comparison.reference).toMatchObject({
          localDateTime: '2026-07-15T13:00',
          timeZone: 'Europe/Madrid'
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('a request that keeps the same weights does not recalculate the route', async () => {
      const current = {
        weights: { shade: 50, sun: 0, wind: 0, vegetation: 0 },
        maxDetourPercentage: 35
      };
      const response = await post(body(current));

      expect(response.body).toEqual({
        assistant: {
          status: 'no_change',
          message: NOTICES.no_change,
          explanation: 'He buscado sombra y acepto hasta un 35 % más de tiempo.',
          before: current,
          after: current,
          changes: []
        },
        comparison: null
      });
      expect(getAlternativeWalkingRoutes).not.toHaveBeenCalled();
    });
  });

  it('sends the model only the request, the weights and the city weather', async () => {
    await post(body());

    expect(userMessageOf(llmClient.completeJson.mock.calls[0])).toEqual({
      peticion: 'prefiero la sombra aunque tarde más',
      pesosActuales: NO_WEIGHTS,
      tiempoExtraMaximoActual: 25,
      tiempoActual: {
        temperaturaC: 31,
        sensacionTermicaC: 33,
        vientoKmh: 40,
        rachasKmh: 60,
        direccionVientoGrados: 270
      }
    });
    const sent = JSON.stringify(llmClient.completeJson.mock.calls[0][0]);
    expect(sent).not.toMatch(/41\.65|-0\.87|-0\.882/);
  });

  it('works when Open-Meteo fails: the model receives no weather', async () => {
    getZaragozaWeather.mockRejectedValue(new Error('down'));
    const response = await post(body());

    expect(response.status).toBe(200);
    expect(userMessageOf(llmClient.completeJson.mock.calls[0]).tiempoActual).toBeNull();
    expect(response.body.assistant.status).toBe('applied');
  });

  describe('when the assistant does not change the route, the answer says why', () => {
    const expectNotice = (response, status) => {
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        assistant: {
          status,
          message: NOTICES[status],
          before: { weights: NO_WEIGHTS, maxDetourPercentage: 25 },
          after: null,
          changes: []
        },
        comparison: null
      });
      expect(getFastestWalkingRoute).not.toHaveBeenCalled();
      expect(getAlternativeWalkingRoutes).not.toHaveBeenCalled();
    };

    it.each(['cuéntame un chiste', 'algo mejor'])('"%s" is not understood', async (message) => {
      expectNotice(await post(body({ message })), 'not_understood');
    });

    it.each([
      ['shade and sun at once', { shade: 50, sun: 50, wind: 0, vegetation: 0 }],
      ['a weight above 100', { shade: 150, sun: 0, wind: 0, vegetation: 0 }]
    ])('an answer with %s is a model error', async (_case, weights) => {
      llmClient.completeJson.mockResolvedValue({
        understood: true,
        weights,
        maxDetourPercentage: 25,
        explanation: 'x'
      });
      expectNotice(await post(body()), 'model_error');
    });

    it('an answer that does not follow the schema is a model error', async () => {
      llmClient.completeJson.mockResolvedValue({ sombra: 'mucha' });
      expectNotice(await post(body()), 'model_error');
    });

    it('a slow model is a timeout', async () => {
      llmClient.completeJson.mockRejectedValue(
        Object.assign(new Error('timed out'), { code: 'timeout' })
      );
      expectNotice(await post(body()), 'timeout');
    });

    it('a provider error is a model error', async () => {
      llmClient.completeJson.mockRejectedValue(
        Object.assign(new Error('HTTP 500'), { code: 'provider_error' })
      );
      expectNotice(await post(body()), 'model_error');
    });

    it('the provider limiting the requests says it is busy', async () => {
      llmClient.completeJson.mockRejectedValue(
        Object.assign(new Error('HTTP 429'), { code: 'rate_limited' })
      );
      expectNotice(await post(body()), 'provider_busy');
    });

    it('without a key it says the assistant is not available, without a 500', async () => {
      llmClient.isConfigured.mockReturnValue(false);
      expectNotice(await post(body()), 'not_configured');
      expect(llmClient.completeJson).not.toHaveBeenCalled();
    });
  });

  describe('usage limits', () => {
    it('a user over the limit per minute gets 429 with a clear message and Retry-After', async () => {
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        expect((await post(body({ message: 'evita el viento' }))).status).toBe(200);
      }

      const response = await post(body({ message: 'evita el viento' }));

      expect(response.status).toBe(429);
      expect(response.body.error.message).toBe(
        'Has hecho muchas peticiones seguidas al asistente. Espera un minuto.'
      );
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      expect(llmClient.completeJson).toHaveBeenCalledTimes(3);
    });

    it('the limit is per user', async () => {
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await post(body({ message: 'evita el viento' }), 1);
      }
      expect((await post(body({ message: 'evita el viento' }), 2)).status).toBe(200);
    });

    it('invalid requests and a missing key do not spend the limit', async () => {
      llmClient.isConfigured.mockReturnValue(false);
      for (let i = 0; i < 4; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await post(body());
      }
      llmClient.isConfigured.mockReturnValue(true);
      for (let i = 0; i < 4; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await post(body({ message: '' }));
      }
      expect((await post(body())).status).toBe(200);
    });
  });

  describe('validation, before calling the model', () => {
    it.each([
      ['an empty message', { message: '   ' }, 'message'],
      ['a message longer than 300 characters', { message: 'a'.repeat(301) }, 'message'],
      ['current weights with shade and sun', { weights: { shade: 10, sun: 10 } }, 'shade'],
      ['an extra time above 40 %', { maxDetourPercentage: 50 }, 'maxDetourPercentage']
    ])('%s → 400', async (_case, overrides, field) => {
      const response = await post(body(overrides));

      expect(response.status).toBe(400);
      expect(response.body.error.fields).toHaveProperty(field);
      expect(llmClient.completeJson).not.toHaveBeenCalled();
    });

    it('a point outside Zaragoza → 400', async () => {
      const response = await post(body({ destination: { lat: 40.4, lng: -3.7 } }));
      expect(response.status).toBe(400);
      expect(llmClient.completeJson).not.toHaveBeenCalled();
    });

    it('an invalid date → 400', async () => {
      const response = await post(body({ date: '2026-13-45' }));
      expect(response.status).toBe(400);
      expect(llmClient.completeJson).not.toHaveBeenCalled();
    });
  });

  describe('the key never leaves the backend', () => {
    const FAKE_KEY = 'gsk_test_secret_value_that_must_not_leak_42';
    const originalEnv = { key: process.env.LLM_API_KEY, level: process.env.LOG_LEVEL };
    let output;

    beforeEach(() => {
      process.env.LLM_API_KEY = FAKE_KEY;
      process.env.LOG_LEVEL = 'debug';
      output = '';
      ['stdout', 'stderr'].forEach((stream) =>
        jest.spyOn(process[stream], 'write').mockImplementation((chunk) => {
          output += String(chunk);
          return true;
        })
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
      ['LLM_API_KEY', 'LOG_LEVEL'].forEach((name, index) => {
        const value = index === 0 ? originalEnv.key : originalEnv.level;
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      });
    });

    it.each([
      ['a provider that rejects the key', jsonFailure(401, `Invalid API Key: ${FAKE_KEY}`)],
      ['a provider that fails', jsonFailure(500, `upstream error for ${FAKE_KEY}`)],
      ['a network error', () => Promise.reject(new Error(`socket hang up Bearer ${FAKE_KEY}`))]
    ])('%s: neither the logs nor the response contain it', async (_case, fetchImpl) => {
      const realClient = createLlmClient(
        {
          apiKey: FAKE_KEY,
          baseUrl: 'https://llm.example.test/v1',
          model: 'test-model',
          reasoningEffort: '',
          maxTokens: 100,
          timeoutMs: 1000
        },
        { fetchImpl }
      );
      llmClient.completeJson.mockImplementation(realClient.completeJson);

      const response = await post(body());

      expect(response.status).toBe(200);
      expect(response.body.assistant.status).toBe('model_error');
      expect(JSON.stringify(response.body)).not.toContain(FAKE_KEY);
      expect(JSON.stringify(response.headers)).not.toContain(FAKE_KEY);
      expect(output).toContain('Route assistant without answer');
      expect(output).not.toContain(FAKE_KEY);
      // The user's text is not logged either.
      expect(output).not.toContain('prefiero la sombra');
    });

    it('the logger hides the key even if some code logs it', () => {
      // eslint-disable-next-line global-require
      const { logger } = require('../utils/logger');
      logger.error(`failed with key ${FAKE_KEY} and header Authorization: Bearer abc.def-123`);

      expect(output).not.toContain(FAKE_KEY);
      expect(output).not.toContain('abc.def-123');
      expect(output).toContain('[REDACTED]');
    });
  });
});
