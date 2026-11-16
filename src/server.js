const { createApp } = require('./app');
const { env } = require('./config/env');
const { warnAboutMissingSettings } = require('./config/startupChecks');

warnAboutMissingSettings();

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`WeatherMapZ API listening on port ${env.port}`);
});
