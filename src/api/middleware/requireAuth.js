const { verifyToken } = require('../../services/auth/tokenService');
const { httpError } = require('../../utils/httpError');

// Lets the request through only with a valid "Authorization: Bearer <token>" header and
// stores the authenticated user id in req.userId.
function requireAuth(req, _res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    next(httpError(401, 'Necesitas iniciar sesión.'));
    return;
  }

  try {
    req.userId = verifyToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireAuth };
