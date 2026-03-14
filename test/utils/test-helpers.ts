import { AsyncLocalStorage } from 'async_hooks'

/**
 * Test helper for AsyncLocalStorage
 */
export class AsyncLocalStorageTestHelper<T> {
    private storage: AsyncLocalStorage<T>

    constructor() {
        this.storage = new AsyncLocalStorage<T>()
    }

    run<R>(store: T, fn: () => R): R {
        return this.storage.run(store, fn)
    }

    getStore(): T | undefined {
        return this.storage.getStore()
    }

    enterWith(store: T): void {
        this.storage.enterWith(store)
    }
}

/**
 * Create test fixtures for logger configuration
 */
export const loggerConfigFixtures = {
    local: {
        level: 'debug',
        env: 'local',
        appName: 'test-app',
    },
    staging: {
        level: 'info',
        env: 'staging',
        appName: 'test-app',
        logGroupName: '/aws/lambda/test-app-backend',
        awsRegion: 'us-east-1',
        retentionDays: 30,
    },
    production: {
        level: 'warn',
        env: 'production',
        appName: 'test-app',
        logGroupName: '/aws/lambda/test-app-backend',
        awsRegion: 'us-east-1',
        retentionDays: 90,
    },
}
