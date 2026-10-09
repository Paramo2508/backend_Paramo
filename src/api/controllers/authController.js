const { env } = require('../../config/env');
const { redirectWithError } = require('../../integrations/google/googleAuth');
const authService = require('../../services/auth/authService');
const { logger } = require('../../utils/logger');

async function postRegister(req, res, next) {
  try {
    res.status(201).json(await authService.register(req.body));
  } catch (error) {
    next(error);
  }
}

async function postLogin(req, res, next) {
  try {
    res.status(200).json(await authService.login(req.body));
  } catch (error) {
    next(error);
  }
}

async function getMe(req, res, next) {
  try {
    res.status(200).json({ user: await authService.getCurrentUser(req.userId) });
  } catch (error) {
    next(error);
  }
}

// The token travels in the URL fragment (#), which browsers never send to any server, so it
// does not end up in access logs. The frontend reads it and removes it from the address bar.
async function getGoogleCallback(req, res) {
  try {
    const { token } = await authService.loginWithGoogle(req.googleIdentity);
    res.redirect(`${env.frontendUrl}/#authToken=${encodeURIComponent(token)}`);
  } catch (error) {
    logger.warn(`Google login rejected: ${error.status || 500}`);
    redirectWithError(res);
  }
}

module.exports = { postRegister, postLogin, getMe, getGoogleCallback };
