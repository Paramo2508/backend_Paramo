const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');

const { env } = require('../../config/env');

const STRATEGY = 'google';
let registeredWith = null;

function isGoogleConfigured() {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

// Keeps the Google profile format inside this adapter.
function toGoogleIdentity(profile) {
  const [email] = profile.emails || [];
  return {
    googleId: profile.id,
    email: email?.value,
    emailVerified: email?.verified === true || email?.verified === 'true',
    name: profile.displayName
  };
}

// Registered lazily so the app (and the tests) start without Google credentials.
function ensureStrategy() {
  const config = `${env.googleClientId}|${env.googleClientSecret}|${env.googleCallbackUrl}`;
  if (registeredWith === config) return;
  passport.use(
    STRATEGY,
    new GoogleStrategy(
      {
        clientID: env.googleClientId,
        clientSecret: env.googleClientSecret,
        callbackURL: env.googleCallbackUrl
      },
      (_accessToken, _refreshToken, profile, done) => done(null, toGoogleIdentity(profile))
    )
  );
  registeredWith = config;
}

function redirectWithError(res) {
  res.redirect(`${env.frontendUrl}/#authError=google`);
}

// GET /api/auth/google: sends the browser to Google's consent screen.
function startGoogleLogin(req, res, next) {
  if (!isGoogleConfigured()) {
    redirectWithError(res);
    return;
  }
  ensureStrategy();
  passport.authenticate(STRATEGY, {
    session: false,
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
}

// GET /api/auth/google/callback: exchanges Google's code and leaves the identity in
// req.googleIdentity. Cancelled or failed logins go back to the frontend with an error.
function finishGoogleLogin(req, res, next) {
  if (!isGoogleConfigured()) {
    redirectWithError(res);
    return;
  }
  ensureStrategy();
  passport.authenticate(STRATEGY, { session: false }, (error, identity) => {
    if (error || !identity) {
      redirectWithError(res);
      return;
    }
    req.googleIdentity = identity;
    next();
  })(req, res, next);
}

module.exports = { startGoogleLogin, finishGoogleLogin, redirectWithError, toGoogleIdentity };
