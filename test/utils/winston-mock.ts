import winston from 'winston'

/**
 * Mock Winston transport for testing
 */
export class MockTransport extends winston.transports.Console {
    public logs: Array<{
        level: string
        message: string
        [key: string]: unknown
    }> = []

    log(info: winston.LogEntry, callback: () => void): void {
        this.logs.push({
            ...info,
            level: info.level,
            message: info.message as string,
        })
        callback()
    }

    clear(): void {
        this.logs = []
    }
}

/**
 * Create a mock Winston logger for testing
 */
export function createMockLogger(): {
    logger: winston.Logger
    transport: MockTransport
} {
    const transport = new MockTransport()
    const logger = winston.createLogger({
        level: 'debug',
        transports: [transport],
    })

    return { logger, transport }
}
