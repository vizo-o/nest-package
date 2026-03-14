import winston from 'winston'

// Unmock dev.transport to ensure we test the real implementation
// Other test files mock this, so we need to explicitly unmock it BEFORE importing
jest.unmock('../../../src/logger-v2/transports/dev.transport')

import { createDevTransport } from '../../../src/logger-v2/transports/dev.transport'

describe('DevTransport', () => {
    let originalEnv: NodeJS.ProcessEnv
    let originalStdoutWrite: typeof process.stdout.write

    beforeEach(() => {
        originalEnv = { ...process.env }
        // Store original stdout.write to restore it properly
        originalStdoutWrite = process.stdout.write.bind(process.stdout)
    })

    afterEach(() => {
        process.env = originalEnv
        // Restore original stdout.write if it was mocked
        if (process.stdout.write !== originalStdoutWrite) {
            process.stdout.write = originalStdoutWrite
        }
    })

    describe('Transport creation', () => {
        it('should create a transport', () => {
            const transport = createDevTransport()
            expect(transport).toBeDefined()
            expect(transport).toBeInstanceOf(winston.transports.Console)
        })

        it('should use debug level in test environment', () => {
            process.env.NODE_ENV = 'test'
            delete process.env.LOG_LEVEL
            const transport = createDevTransport()
            expect(transport).toBeDefined()
            // Should default to debug level (not suppress in test)
            expect(
                (transport as winston.transports.ConsoleTransportOptions).level,
            ).toBe('debug')
        })

        it('should use debug level in development', () => {
            process.env.NODE_ENV = 'development'
            delete process.env.LOG_LEVEL
            const transport = createDevTransport()
            expect(transport).toBeDefined()
            expect(
                (transport as winston.transports.ConsoleTransportOptions).level,
            ).toBe('debug')
        })

        it('should respect LOG_LEVEL environment variable', () => {
            process.env.NODE_ENV = 'development'
            process.env.LOG_LEVEL = 'info'
            const transport = createDevTransport()
            expect(transport).toBeDefined()
            expect(
                (transport as winston.transports.ConsoleTransportOptions).level,
            ).toBe('info')
        })
    })

    describe('Log level configuration', () => {
        it('should respect LOG_LEVEL environment variable', () => {
            process.env.LOG_LEVEL = 'warn'
            const transport = createDevTransport()
            expect(
                (transport as winston.transports.ConsoleTransportOptions).level,
            ).toBe('warn')
        })

        it('should default to debug level when LOG_LEVEL is not set', () => {
            delete process.env.LOG_LEVEL
            const transport = createDevTransport()
            expect(
                (transport as winston.transports.ConsoleTransportOptions).level,
            ).toBe('debug')
        })
    })

    // Helper to get the printf formatter function from dev transport
    function getDevFormatterFn(): (
        info: winston.Logform.TransformableInfo,
    ) => string {
        const transport = createDevTransport()
        const format = (transport as { format?: winston.Logform.Format }).format
        if (!format) {
            throw new Error('Dev transport has no format')
        }

        // Winston's format.printf stores the printf function in the 'template' property
        const formatWithTemplate = format as unknown as {
            template?: (info: winston.Logform.TransformableInfo) => string
        }

        if (
            formatWithTemplate.template &&
            typeof formatWithTemplate.template === 'function'
        ) {
            return formatWithTemplate.template
        }

        throw new Error('Could not extract printf function from format')
    }

    describe('Output format', () => {
        it('should format logs with service name', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                service: 'TestService',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)

            expect(output).toContain('TestService')
            expect(output).toContain('test message')
            expect(output).toContain('INFO')
        })

        it('should format logs with request ID', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                requestId: 'req-123',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)
            expect(output).toContain('req-123')
            expect(output).toContain('test message')
        })

        it('should format logs with both service name and request ID', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                service: 'TestService',
                requestId: 'req-123',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)
            expect(output).toContain('TestService')
            expect(output).toContain('req-123')
            expect(output).toContain('test message')
        })

        it('should include additional context in formatted output', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                userId: 'user-123',
                operation: 'test-op',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)
            expect(output).toContain('test message')
            // Additional context should be included as JSON
            expect(output).toContain('user-123')
            expect(output).toContain('test-op')
        })

        it('should format error level logs correctly', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'error',
                message: 'error message',
                service: 'TestService',
                [Symbol.for('level')]: 'error',
                [Symbol.for('message')]: 'error message',
            }

            const output = formatterFn(logInfo)
            expect(output).toContain('ERROR')
            expect(output).toContain('error message')
            expect(output).toContain('TestService')
        })

        it('should format warn level logs correctly', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'warn',
                message: 'warn message',
                service: 'TestService',
                [Symbol.for('level')]: 'warn',
                [Symbol.for('message')]: 'warn message',
            }

            const output = formatterFn(logInfo)
            expect(output).toContain('WARN')
            expect(output).toContain('warn message')
            expect(output).toContain('TestService')
        })

        it('should include emoji for different log levels', () => {
            const formatterFn = getDevFormatterFn()

            const errorInfo: winston.Logform.TransformableInfo = {
                level: 'error',
                message: 'error message',
                [Symbol.for('level')]: 'error',
                [Symbol.for('message')]: 'error message',
            }
            expect(formatterFn(errorInfo)).toContain('🚨')

            const warnInfo: winston.Logform.TransformableInfo = {
                level: 'warn',
                message: 'warn message',
                [Symbol.for('level')]: 'warn',
                [Symbol.for('message')]: 'warn message',
            }
            expect(formatterFn(warnInfo)).toContain('🔔')

            const infoInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'info message',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'info message',
            }
            expect(formatterFn(infoInfo)).toContain('📡')

            const debugInfo: winston.Logform.TransformableInfo = {
                level: 'debug',
                message: 'debug message',
                [Symbol.for('level')]: 'debug',
                [Symbol.for('message')]: 'debug message',
            }
            expect(formatterFn(debugInfo)).toContain('🐛')
        })

        it('should include timestamp in formatted output', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)
            // Timestamp format: [HH:MM:SS AM/PM]
            expect(output).toMatch(/\[\d{1,2}:\d{2}:\d{2}\s(AM|PM)\]/)
        })
    })

    describe('Metadata filtering', () => {
        it('should exclude timestamp from additional context', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                timestamp: '2024-01-01T00:00:00Z',
                userId: 'user-123',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)

            // Should include userId but not timestamp
            expect(output).toContain('user-123')
            expect(output).not.toContain('2024-01-01T00:00:00Z')
            expect(output).not.toContain('"timestamp"')
        })

        it('should exclude requestId from additional context', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                requestId: 'req-456',
                operation: 'test-op',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)

            // Should include operation but not requestId in additional context
            // (requestId is shown in header, not in additional context)
            expect(output).toContain('test-op')
            expect(output).not.toContain('"requestId"')
        })

        it('should exclude level from additional context', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                customField: 'custom-value',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)

            // Should include customField but not level in additional context
            expect(output).toContain('custom-value')
            expect(output).not.toContain('"level"')
        })

        it('should exclude message from additional context', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                metadata: { key: 'value' },
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)

            // Should include metadata but not message in additional context
            expect(output).toContain('metadata')
            expect(output).not.toContain('"message"')
        })

        it('should exclude service from additional context', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                service: 'TestService',
                customData: 'test-data',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)

            // Should include customData but not service in additional context
            // (service is shown in header, not in additional context)
            expect(output).toContain('test-data')
            expect(output).not.toContain('"service"')
        })

        it('should exclude all Winston metadata keys from additional context', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                timestamp: '2024-01-01T00:00:00Z',
                requestId: 'req-789',
                service: 'TestService',
                userId: 'user-123',
                operation: 'test-op',
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)

            // Should only include non-excluded fields in additional context
            expect(output).toContain('user-123')
            expect(output).toContain('test-op')
            expect(output).not.toContain('"timestamp"')
            expect(output).not.toContain('"requestId"')
            expect(output).not.toContain('"level"')
            expect(output).not.toContain('"message"')
            expect(output).not.toContain('"service"')
        })

        it('should include custom fields that are not in excluded list', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                customField1: 'value1',
                customField2: 'value2',
                nested: { data: 'test' },
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)

            // Should include all custom fields
            expect(output).toContain('customField1')
            expect(output).toContain('value1')
            expect(output).toContain('customField2')
            expect(output).toContain('value2')
            expect(output).toContain('nested')
        })

        it('should handle undefined values correctly', () => {
            const formatterFn = getDevFormatterFn()
            const logInfo: winston.Logform.TransformableInfo = {
                level: 'info',
                message: 'test message',
                definedField: 'value',
                undefinedField: undefined,
                nullField: null,
                [Symbol.for('level')]: 'info',
                [Symbol.for('message')]: 'test message',
            }

            const output = formatterFn(logInfo)

            // Should include definedField and nullField, but not undefinedField
            expect(output).toContain('definedField')
            expect(output).toContain('nullField')
            expect(output).not.toContain('undefinedField')
        })
    })
})
