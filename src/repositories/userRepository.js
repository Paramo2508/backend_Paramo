const { User } = require('./models');

const ATTRIBUTES = ['id', 'name', 'email', 'passwordHash', 'googleId'];

function findById(id) {
  return User.findByPk(id, { attributes: ATTRIBUTES, raw: true });
}

function findByEmail(email) {
  return User.findOne({ where: { email }, attributes: ATTRIBUTES, raw: true });
}

function findByGoogleId(googleId) {
  return User.findOne({ where: { googleId }, attributes: ATTRIBUTES, raw: true });
}

async function createUser({ name, email, passwordHash = null, googleId = null }) {
  const user = await User.create({ name, email, passwordHash, googleId });
  return user.get({ plain: true });
}

async function linkGoogleAccount(id, googleId) {
  await User.update({ googleId }, { where: { id } });
  return findById(id);
}

module.exports = { findById, findByEmail, findByGoogleId, createUser, linkGoogleAccount };
