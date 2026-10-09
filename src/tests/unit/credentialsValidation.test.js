const {
  normalizeEmail,
  validateLogin,
  validateRegistration
} = require('../../domain/auth/credentialsValidation');

describe('credentials validation', () => {
  const valid = { name: '  Ana López ', email: ' Ana@Correo.ES ', password: 'segura123' };

  it('normalizes a valid registration', () => {
    expect(validateRegistration(valid)).toEqual({
      values: { name: 'Ana López', email: 'ana@correo.es', password: 'segura123' }
    });
  });

  it('reports every invalid registration field at once', () => {
    expect(
      validateRegistration({ name: ' ', email: 'no-es-un-correo', password: 'corta' })
    ).toEqual({
      fields: {
        name: 'Introduce tu nombre.',
        email: 'Introduce un correo electrónico válido.',
        password: 'La contraseña debe tener al menos 8 caracteres.'
      }
    });
  });

  it.each([
    [{ ...valid, name: 'a'.repeat(101) }, 'name', 'El nombre no puede superar los 100 caracteres.'],
    [{ ...valid, email: '' }, 'email', 'Introduce tu correo electrónico.'],
    [
      { ...valid, email: `${'a'.repeat(250)}@b.es` },
      'email',
      'Introduce un correo electrónico válido.'
    ],
    [{ ...valid, password: undefined }, 'password', 'Introduce una contraseña.'],
    [{ ...valid, password: 'ñ'.repeat(37) }, 'password', 'La contraseña es demasiado larga.']
  ])('rejects %# with a message for the field', (input, field, message) => {
    expect(validateRegistration(input).fields).toEqual({ [field]: message });
  });

  it('handles a missing body', () => {
    expect(Object.keys(validateRegistration().fields)).toEqual(['name', 'email', 'password']);
    expect(Object.keys(validateLogin().fields)).toEqual(['email', 'password']);
  });

  it('only requires email and password on login', () => {
    expect(validateLogin({ email: 'ANA@correo.es', password: 'x' })).toEqual({
      values: { email: 'ana@correo.es', password: 'x' }
    });
    expect(validateLogin({ email: 'ana@correo.es', password: '' }).fields).toEqual({
      password: 'Introduce tu contraseña.'
    });
  });

  it('normalizes only strings', () => {
    expect(normalizeEmail(42)).toBe('');
  });
});
