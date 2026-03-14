import winston from 'winston'
import type { LogContext } from '../../src/logger-v2/types'

/**
 * Mock Winston transport that captures logs for testing
 */
export class TestTransport extends winston.transports.Console {
    public capturedLogs: Array<{
        level: string
        message: string
        [key: string]: unknown
    }> = []

    log(info: winston.LogEntry, callback: () => void): void {
        // Winston concatenates message if it's in both the parameter and metadata
        // The logger service passes: winstonLogger.log(level, message, { message, ...metadata })
        // So Winston receives the message twice and concatenates: "msg msg"
        // Extract the actual message by taking the first part
        let message = String(info.message || '')
        // Handle Winston's message duplication (e.g., "test message test message")
        // Split by space and check if first half equals second half
        const messageParts = message.split(' ')
        if (messageParts.length >= 2) {
            const midPoint = Math.ceil(messageParts.length / 2)
            const firstHalf = messageParts.slice(0, midPoint).join(' ')
            const secondHalf = messageParts.slice(midPoint).join(' ')
            if (firstHalf === secondHalf) {
                message = firstHalf
            }
        }

        // Extract all metadata except level and message
        const { message: _msg, level: _lvl, ...metadata } = info

        const logEntry: {
            level: string
            message: string
            [key: string]: unknown
        } = {
            level: info.level,
            message,
            ...metadata,
        }
        this.capturedLogs.push(logEntry)
        callback()
    }

    clear(): void {
        this.capturedLogs = []
    }

    getLastLog():
        | {
              level: string
              message: string
              [key: string]: unknown
          }
        | undefined {
        return this.capturedLogs[this.capturedLogs.length - 1]
    }

    getLogsByLevel(level: string): Array<{
        level: string
        message: string
        [key: string]: unknown
    }> {
        return this.capturedLogs.filter((log) => log.level === level)
    }
}

/**
 * Create a test logger with a capture transport
 */
export function createTestLogger(): {
    logger: winston.Logger
    transport: TestTransport
} {
    const transport = new TestTransport()
    const logger = winston.createLogger({
        level: 'debug',
        transports: [transport],
        format: winston.format.json(),
    })

    return { logger, transport }
}

/**
 * Helper to extract log context from Winston log entry
 */
export function extractLogContext(
    logEntry: Record<string, unknown>,
): LogContext {
    const {
        level: _level,
        message: _message,
        timestamp: _timestamp,
        ...context
    } = logEntry

    return context as LogContext
}
