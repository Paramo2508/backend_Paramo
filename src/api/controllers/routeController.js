const { calculateFastestRoute } = require('../../services/routing/fastestRouteService');
const { adjustRouteWithAssistant } = require('../../services/routing/routeAssistantService');
const { calculateRecommendedRoute } = require('../../services/routing/recommendedRouteService');
const { calculateShadedRouteComparison } = require('../../services/routing/shadedRouteService');
const { calculateWeightedRouteComparison } = require('../../services/routing/weightedRouteService');

async function postFastestRoute(req, res, next) {
  try {
    const route = await calculateFastestRoute(req.body);
    res.status(200).json({ route });
  } catch (error) {
    next(error);
  }
}

async function postShadedRoute(req, res, next) {
  try {
    const comparison = await calculateShadedRouteComparison(req.body);
    res.status(200).json({ comparison });
  } catch (error) {
    next(error);
  }
}

async function postWeightedRoute(req, res, next) {
  try {
    const comparison = await calculateWeightedRouteComparison(req.body);
    res.status(200).json({ comparison });
  } catch (error) {
    next(error);
  }
}

// Recommended route (PBI-9.1): the weights are chosen with the current weather (ADR-029).
async function postRecommendedRoute(req, res, next) {
  try {
    const comparison = await calculateRecommendedRoute(req.body);
    res.status(200).json({ comparison });
  } catch (error) {
    next(error);
  }
}

// Route assistant (PBI-9.2): a language model turns the request into weights (ADR-033).
async function postAssistantRoute(req, res, next) {
  try {
    res.status(200).json(await adjustRouteWithAssistant(req.body, { userId: req.userId }));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  postAssistantRoute,
  postFastestRoute,
  postRecommendedRoute,
  postShadedRoute,
  postWeightedRoute
};
