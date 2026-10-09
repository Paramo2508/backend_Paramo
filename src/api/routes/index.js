const { Router } = require('express');

const { requireAuth } = require('../middleware/requireAuth');
const { authRouter } = require('./authRoutes');
const { geocodingRouter } = require('./geocodingRoutes');
const { healthRouter } = require('./healthRoutes');
const { routeRouter } = require('./routeRoutes');

const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/geocoding', requireAuth, geocodingRouter);
apiRouter.use('/health', healthRouter);
apiRouter.use('/routes', requireAuth, routeRouter);

module.exports = { apiRouter };
