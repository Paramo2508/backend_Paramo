module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        "ALTER TABLE users ADD COLUMN tutorial_status VARCHAR(10), ADD CONSTRAINT users_tutorial_status_check CHECK (tutorial_status IS NULL OR tutorial_status IN ('completed', 'skipped'));",
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tutorial_status_check, DROP COLUMN IF EXISTS tutorial_status;'
    );
  }
};
