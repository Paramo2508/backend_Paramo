const { Router } = require('express');

const {
  getGoogleCallback,
  getMe,
  postLogin,
  postRegister
} = require('../controllers/authController');
const { requireAuth } = require('../middleware/requireAuth');
const { finishGoogleLogin, startGoogleLogin } = require('../../integrations/google/googleAuth');

const authRouter = Router();

authRouter.post('/register', postRegister);
authRouter.post('/login', postLogin);
authRouter.get('/me', requireAuth, getMe);
authRouter.get('/google', startGoogleLogin);
authRouter.get('/google/callback', finishGoogleLogin, getGoogleCallback);

module.exports = { authRouter };
