module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(254) NOT NULL,
        password_hash VARCHAR(100),
        google_id VARCHAR(255) UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT users_credentials_check CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)
      );
      CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS users;');
  }
};
