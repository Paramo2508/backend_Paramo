const NAME_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MIN_LENGTH = 8;
// bcrypt ignores everything after the first 72 bytes, so longer passwords are rejected
// instead of being silently truncated.
const PASSWORD_MAX_BYTES = 72;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function validateEmail(email) {
  if (!email) return 'Introduce tu correo electrónico.';
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return 'Introduce un correo electrónico válido.';
  }
  return null;
}

function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length === 0) return 'Introduce una contraseña.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return 'La contraseña es demasiado larga.';
  }
  return null;
}

function result(values, errors) {
  const fields = Object.fromEntries(Object.entries(errors).filter(([, message]) => message));
  return Object.keys(fields).length > 0 ? { fields } : { values };
}

function validateRegistration({ name, email, password } = {}) {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = normalizeEmail(email);
  let nameError = null;
  if (!trimmedName) nameError = 'Introduce tu nombre.';
  else if (trimmedName.length > NAME_MAX_LENGTH) {
    nameError = `El nombre no puede superar los ${NAME_MAX_LENGTH} caracteres.`;
  }

  return result(
    { name: trimmedName, email: normalizedEmail, password },
    {
      name: nameError,
      email: validateEmail(normalizedEmail),
      password: validateNewPassword(password)
    }
  );
}

// Login only checks that both fields are present: password rules are enforced on registration,
// and reporting them here would reveal nothing useful.
function validateLogin({ email, password } = {}) {
  const normalizedEmail = normalizeEmail(email);
  return result(
    { email: normalizedEmail, password },
    {
      email: validateEmail(normalizedEmail),
      password:
        typeof password === 'string' && password.length > 0 ? null : 'Introduce tu contraseña.'
    }
  );
}

module.exports = { normalizeEmail, validateRegistration, validateLogin, PASSWORD_MIN_LENGTH };
