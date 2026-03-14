const fs = require('fs')
const path = require('path')
const { compilerOptions } = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'tsconfig.test.json'), 'utf8'),
)

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/*.spec.ts'],
    collectCoverageFrom: [
        'src/logger-v2/**/*.ts',
        '!src/logger-v2/**/*.spec.ts',
        '!src/logger-v2/**/*.d.ts',
        '!src/logger-v2/index.ts',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: {
                    ...compilerOptions,
                    isolatedModules: false,
                },
            },
        ],
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
    roots: ['<rootDir>'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    moduleDirectories: ['node_modules', '<rootDir>'],
}
