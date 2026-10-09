const jwt = require('jsonwebtoken');

const { env } = require('../../config/env');
const { httpError } = require('../../utils/httpError');

const ALGORITHM = 'HS256';

function requireSecret() {
  if (!env.jwtSecret) {
    throw httpError(503, 'La autenticación no está configurada.');
  }
  return env.jwtSecret;
}

function signToken(user) {
  return jwt.sign({ sub: String(user.id) }, requireSecret(), {
    algorithm: ALGORITHM,
    expiresIn: env.jwtExpiresIn
  });
}

// Returns the user id stored in a valid token. Any invalid, expired or tampered token is
// reported as 401 without saying why.
function verifyToken(token) {
  const secret = requireSecret();
  try {
    const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Invalid subject');
    return userId;
  } catch {
    throw httpError(401, 'Tu sesión no es válida o ha caducado. Inicia sesión de nuevo.');
  }
}

module.exports = { signToken, verifyToken };
