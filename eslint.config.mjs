import { createSharedConfig } from '@vizo-o/dev-tools/eslint-config/eslint.config.mjs'

const config = createSharedConfig({ isNodeEnv: true })

// Add Jest environment for test files
config.push({
    files: ['**/*.spec.ts', '**/test/**/*.ts'],
    languageOptions: {
        globals: {
            jest: 'readonly',
            describe: 'readonly',
            it: 'readonly',
            expect: 'readonly',
            beforeEach: 'readonly',
            afterEach: 'readonly',
            beforeAll: 'readonly',
            afterAll: 'readonly',
            NodeJS: 'readonly',
        },
    },
})

export default config
