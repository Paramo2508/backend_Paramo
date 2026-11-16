const coverageExclusions = [
  '!src/server.js',
  '!src/config/**',
  // Test code (helpers such as the integration globalSetup) is not production code (#162).
  '!src/tests/**',
  '!src/repositories/migrations/**',
  '!src/integrations/importAll.js'
];

module.exports = {
  testEnvironment: 'node',
  cacheDirectory: '<rootDir>/.jest-cache',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/tests/integration/'],
  collectCoverageFrom: ['src/**/*.js', ...coverageExclusions],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    }
  }
};
