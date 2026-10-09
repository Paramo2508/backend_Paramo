const bcrypt = require('bcrypt');
const { UniqueConstraintError } = require('sequelize');

const { validateLogin, validateRegistration } = require('../../domain/auth/credentialsValidation');
const userRepository = require('../../repositories/userRepository');
const { httpError } = require('../../utils/httpError');
const { signToken } = require('./tokenService');

const BCRYPT_ROUNDS = 10;
const INVALID_CREDENTIALS = 'El correo o la contraseña no son correctos.';
const EMAIL_IN_USE = 'Ya existe una cuenta con este correo electrónico.';

function toPublicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function validationError(fields) {
  return httpError(400, 'Revisa los datos marcados.', fields);
}

function session(user) {
  return { token: signToken(user), user: toPublicUser(user) };
}

async function register(input) {
  const { fields, values } = validateRegistration(input);
  if (fields) throw validationError(fields);

  if (await userRepository.findByEmail(values.email)) {
    throw httpError(409, EMAIL_IN_USE, { email: EMAIL_IN_USE });
  }

  const passwordHash = await bcrypt.hash(values.password, BCRYPT_ROUNDS);
  try {
    const user = await userRepository.createUser({
      name: values.name,
      email: values.email,
      passwordHash
    });
    return session(user);
  } catch (error) {
    // Two simultaneous registrations with the same email: the unique index decides.
    if (error instanceof UniqueConstraintError) {
      throw httpError(409, EMAIL_IN_USE, { email: EMAIL_IN_USE });
    }
    throw error;
  }
}

// Unknown email, wrong password and Google-only accounts all get the same 401 so the response
// does not reveal which emails are registered.
async function login(input) {
  const { fields, values } = validateLogin(input);
  if (fields) throw validationError(fields);

  const user = await userRepository.findByEmail(values.email);
  const passwordMatches =
    Boolean(user?.passwordHash) && (await bcrypt.compare(values.password, user.passwordHash));
  if (!passwordMatches) throw httpError(401, INVALID_CREDENTIALS);

  return session(user);
}

/*
 * Resolves the WeatherMapZ account for a Google identity:
 * 1. an account already linked to that Google id;
 * 2. otherwise an account with the same email, which gets linked (only if Google has verified
 *    the email, so nobody can take over an account with an unverified address);
 * 3. otherwise a new account without password.
 */
async function loginWithGoogle({ googleId, email, emailVerified, name } = {}) {
  if (!googleId) throw httpError(401, 'Google no ha devuelto una cuenta válida.');

  const linkedUser = await userRepository.findByGoogleId(googleId);
  if (linkedUser) return session(linkedUser);

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail || !emailVerified) {
    throw httpError(401, 'Tu cuenta de Google no tiene un correo verificado.');
  }

  const existingUser = await userRepository.findByEmail(normalizedEmail);
  if (existingUser) {
    return session(await userRepository.linkGoogleAccount(existingUser.id, googleId));
  }

  const newUser = await userRepository.createUser({
    name: (name || normalizedEmail.split('@')[0]).trim().slice(0, 100),
    email: normalizedEmail,
    googleId
  });
  return session(newUser);
}

async function getCurrentUser(userId) {
  const user = await userRepository.findById(userId);
  if (!user) throw httpError(401, 'Tu sesión no es válida o ha caducado. Inicia sesión de nuevo.');
  return toPublicUser(user);
}

module.exports = { register, login, loginWithGoogle, getCurrentUser };
