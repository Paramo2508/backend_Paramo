// PBI-21 (ADR-037): «Según el tiempo de hoy» is kept in the account with the simple preferences.
// It is on for a new user and afterwards it is whatever the user chose last.
//
// The rows that already exist are of users who chose their own answers (migrated from a saved route
// they touched, or saved with PBI-18), so they keep them: the column is added as false and only then
// its default becomes true for the rows created from now on. A user without a row gets the defaults
// of the service, where it is on as well.
module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        'ALTER TABLE route_preferences ADD COLUMN by_weather BOOLEAN NOT NULL DEFAULT false;',
        { transaction }
      );
      await sequelize.query(
        'ALTER TABLE route_preferences ALTER COLUMN by_weather SET DEFAULT true;',
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE route_preferences DROP COLUMN IF EXISTS by_weather;'
    );
  }
};
