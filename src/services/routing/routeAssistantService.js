const { DateTime } = require('luxon');

const { assistantConfig } = require('../../config/assistantConfig');
const { importConfig } = require('../../config/importConfig');
const {
  buildPrompt,
  interpretReply,
  settingChanges
} = require('../../domain/assistant/routeAssistant');
const {
  validateRoutePoints,
  validateShadedRouteRequest
} = require('../../domain/routes/routeRequest');
const { parseMaxDetour, parseWeights } = require('../../domain/routes/routeWeights');
const { ZARAGOZA_TIME_ZONE } = require('../../domain/solar/solarPosition');
const { llmClient } = require('../../integrations/llm/llmClient');
const { httpError } = require('../../utils/httpError');
const { logger } = require('../../utils/logger');
const { createRateLimiter } = require('../assistant/assistantRateLimiter');
const { getZaragozaWeather } = require('../weather/weatherService');
const { calculateWeightedRouteComparison } = require('./weightedRouteService');

// What the user reads when the assistant does not change the route (ADR-033). The route and the
// weights they had stay as they were.
const NOTICES = {
  not_configured:
    'El asistente no está disponible en este servidor. Puedes ajustar la ruta a mano.',
  not_understood:
    'No he entendido la petición. Prueba con algo como «prefiero la sombra aunque tarde más» o «evita el viento».',
  no_change: 'Tu ruta ya tiene esos pesos: no cambia nada.',
  timeout: 'El asistente ha tardado demasiado. Tu ruta no ha cambiado; inténtalo de nuevo.',
  model_error: 'El asistente no ha podido responder. Tu ruta no ha cambiado; inténtalo más tarde.',
  provider_busy:
    'El asistente está muy solicitado ahora mismo. Tu ruta no ha cambiado; inténtalo en un rato.'
};

const LIMIT_MESSAGES = {
  'user:minute': 'Has hecho muchas peticiones seguidas al asistente. Espera un minuto.',
  'user:day': 'Has llegado al máximo de peticiones al asistente de hoy. Vuelve mañana.',
  'global:minute': 'El asistente está atendiendo muchas peticiones. Espera un minuto.',
  'global:day': 'El asistente ha llegado a su máximo de peticiones de hoy. Vuelve mañana.'
};

const defaultLimiter = createRateLimiter(assistantConfig.limits);

function validateMessage(message, maxLength) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || text.length > maxLength) {
    throw httpError(400, 'La petición al asistente no es válida.', {
      message: `Escribe tu petición en 1 a ${maxLength} caracteres.`
    });
  }
  return text;
}

// Everything is checked before spending a request of the model.
function validateAssistantRequest(input, config) {
  if (input?.date !== undefined || input?.time !== undefined) {
    validateShadedRouteRequest(input, importConfig.zaragozaBbox);
  } else {
    validateRoutePoints(input, importConfig.zaragozaBbox);
  }
  return {
    message: validateMessage(input?.message, config.maxMessageLength),
    before: {
      weights: parseWeights(input?.weights),
      maxDetourPercentage: parseMaxDetour(input?.maxDetourPercentage)
    }
  };
}

// The weather is only context for the model: without it the assistant still works.
async function contextWeather(weather) {
  try {
    return await weather();
  } catch {
    return null;
  }
}

function statusOfError(error) {
  if (error.code === 'timeout') return 'timeout';
  if (error.code === 'rate_limited') return 'provider_busy';
  return 'model_error';
}

/*
 * A weighted route needs a date and time (the sun of its candidates); the user may not have chosen
 * one (the fastest route, a wind-only route or the recommended route). Then the route is for now,
 * like the recommended one.
 */
function routeMoment(input, now) {
  if (input.date !== undefined || input.time !== undefined) {
    return { date: input.date, time: input.time, timeZone: input.timeZone };
  }
  const local = DateTime.fromJSDate(now, { zone: ZARAGOZA_TIME_ZONE });
  return {
    date: local.toFormat('yyyy-MM-dd'),
    time: local.toFormat('HH:mm'),
    timeZone: ZARAGOZA_TIME_ZONE
  };
}

const notice = (status, before, extra = {}) => ({
  assistant: { status, message: NOTICES[status], before, after: null, changes: [], ...extra },
  comparison: null
});

/**
 * The route assistant (PBI-9.2, ADR-033): the language model turns the user's request into new
 * weights, the backend checks them like any route and recalculates it as POST /api/routes/weighted.
 * When the model is not set up, fails, is slow or does not understand, the answer is 200 with
 * `comparison: null` and a notice, so the frontend keeps the current route.
 */
async function adjustRouteWithAssistant(
  input,
  {
    userId,
    llm = llmClient,
    limiter = defaultLimiter,
    config = assistantConfig,
    weather = getZaragozaWeather,
    now = () => new Date(),
    weightedComparison = calculateWeightedRouteComparison,
    ...dependencies
  } = {}
) {
  const { message, before } = validateAssistantRequest(input, config);
  if (!llm.isConfigured()) return notice('not_configured', before);

  const limit = limiter.consume(userId);
  if (limit) {
    throw Object.assign(httpError(429, LIMIT_MESSAGES[`${limit.scope}:${limit.window}`]), {
      retryAfterSeconds: limit.retryAfterSeconds
    });
  }

  let reply;
  try {
    const prompt = buildPrompt({ message, ...before, weather: await contextWeather(weather) });
    reply = interpretReply(await llm.completeJson(prompt), before);
  } catch (error) {
    // Only the code and a message without the key or the user's text (ADR-033).
    logger.warn(`Route assistant without answer (${error.code || 'error'}): ${error.message}`);
    return notice(statusOfError(error), before);
  }

  if (!reply.understood) return notice('not_understood', before);
  const after = { weights: reply.weights, maxDetourPercentage: reply.maxDetourPercentage };
  const changes = settingChanges(before, after);
  if (!changes.length) {
    return notice('no_change', before, { explanation: reply.explanation, after: before });
  }

  const comparison = await weightedComparison(
    {
      origin: input.origin,
      destination: input.destination,
      ...routeMoment(input, now()),
      ...after
    },
    { weather, ...dependencies }
  );
  return {
    assistant: { status: 'applied', explanation: reply.explanation, before, after, changes },
    comparison
  };
}

// The limiter is exported so the tests can start every case with empty counters.
module.exports = { NOTICES, adjustRouteWithAssistant, assistantLimiter: defaultLimiter };
