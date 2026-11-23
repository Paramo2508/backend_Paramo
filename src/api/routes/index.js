const { Router } = require('express');

const { requireAuth } = require('../middleware/requireAuth');
const { authRouter } = require('./authRoutes');
const { dataRouter } = require('./dataRoutes');
const { geocodingRouter } = require('./geocodingRoutes');
const { healthRouter } = require('./healthRoutes');
const { recentPlacesRouter } = require('./recentPlacesRoutes');
const { routeFavoriteRouter } = require('./routeHistoryRoutes');
const { routePreferencesRouter } = require('./routePreferencesRoutes');
const { routeRouter } = require('./routeRoutes');
const { weatherRouter } = require('./weatherRoutes');
const { segmentRouter } = require('./segmentRoutes');

const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/data', requireAuth, dataRouter);
apiRouter.use('/geocoding', requireAuth, geocodingRouter);
apiRouter.use('/health', healthRouter);
apiRouter.use('/routes', requireAuth, routeRouter);
apiRouter.use('/route-preferences', requireAuth, routePreferencesRouter);
apiRouter.use('/recent-places', requireAuth, recentPlacesRouter);
apiRouter.use('/route-favorites', requireAuth, routeFavoriteRouter);
apiRouter.use('/weather', requireAuth, weatherRouter);
apiRouter.use('/segments', requireAuth, segmentRouter);

module.exports = { apiRouter };
