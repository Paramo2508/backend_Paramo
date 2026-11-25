const { sequelize } = require('../../config/database');
const userRepository = require('../../repositories/userRepository');

describe('tutorial state (PostgreSQL, PBI-20)', () => {
  beforeEach(async () => {
    await sequelize.query('TRUNCATE users RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('persists completed or skipped state on the user account', async () => {
    const user = await userRepository.createUser({
      name: 'Ana',
      email: 'ana@example.com',
      passwordHash: 'test-hash'
    });

    const skipped = await userRepository.setTutorialStatus(user.id, 'skipped');
    expect(skipped.tutorialStatus).toBe('skipped');

    const restored = await userRepository.findById(user.id);
    expect(restored.tutorialStatus).toBe('skipped');
  });
});
