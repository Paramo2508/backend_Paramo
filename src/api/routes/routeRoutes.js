const { Router } = require('express');

const {
  postAssistantRoute,
  postFastestRoute,
  postPreferredRoute,
  postRecommendedRoute,
  postShadedRoute
} = require('../controllers/routeController');

const routeRouter = Router();

routeRouter.post('/fastest', postFastestRoute);
routeRouter.post('/shaded', postShadedRoute);
routeRouter.post('/preferred', postPreferredRoute);
routeRouter.post('/recommended', postRecommendedRoute);
routeRouter.post('/assistant', postAssistantRoute);

module.exports = { routeRouter };
