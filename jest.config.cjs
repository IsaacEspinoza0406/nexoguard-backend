module.exports = {
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: { module: 'ESNext', moduleResolution: 'bundler' } }],
  },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup.mjs'],
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
};
