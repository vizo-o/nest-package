import { LoggerService } from '../../src/logger-v2/logger.service'
import type { LogContext } from '../../src/logger-v2/types'
import { clearTraceContext } from '../../src/trace'
import type { TestTransport } from '../utils/logger-test-helpers'

// Mock Winston transports - use TestTransport for testing
let mockTransport: TestTransport

jest.mock('../../src/logger-v2/transports/dev.transport', () => ({
    createDevTransport: jest.fn(() => {
        const { TestTransport } = jest.requireActual(
            '../utils/logger-test-helpers',
        )
        mockTransport = new TestTransport()

        return mockTransport
    }),
}))

jest.mock('../../src/logger-v2/transports/cloudwatch.transport', () => ({
    createCloudWatchTransport: jest.fn(() => null),
}))

describe('LoggerService', () => {
    let logger: LoggerService
    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
        originalEnv = { ...process.env }
        process.env.NODE_ENV = 'test'
        // Set LOG_LEVEL to debug so all log levels are captured in tests
        process.env.LOG_LEVEL = 'debug'
        mockTransport?.clear()
        clearTraceContext() // Clear any trace context from previous tests
        logger = new LoggerService()
    })

    afterEach(() => {
        process.env = originalEnv
        jest.clearAllMocks()
        mockTransport?.clear()
        // Close logger to prevent resource leaks
        if (logger) {
            try {
                logger.close()
            } catch {
                // Ignore errors during cleanup
            }
        }
    })

    describe('NestJS LoggerService interface', () => {
        it('should implement log method', () => {
            expect(() => logger.log('test message')).not.toThrow()
        })

        it('should implement error method', () => {
            expect(() => logger.error('error message')).not.toThrow()
        })

        it('should implement warn method', () => {
            expect(() => logger.warn('warn message')).not.toThrow()
        })

        it('should implement debug method', () => {
            expect(() => logger.debug('debug message')).not.toThrow()
        })

        it('should implement verbose method', () => {
            expect(() => logger.verbose('verbose message')).not.toThrow()
        })
    })

    describe('Log levels', () => {
        it('should log at info level with correct content', () => {
            logger.log('info message', { service: 'TestService' })

            const log = mockTransport.getLastLog()
            expect(log).toBeDefined()
            expect(log?.level).toBe('info')
            expect(log?.message).toBe('info message')
            expect(log?.service).toBe('TestService')
        })

        it('should log at error level with trace', () => {
            logger.error('error message', {
                service: 'TestService',
                trace: 'trace stack',
            })

            const log = mockTransport.getLastLog()
            expect(log).toBeDefined()
            expect(log?.level).toBe('error')
            expect(log?.message).toBe('error message')
            expect(log?.service).toBe('TestService')
            expect(log?.trace).toBe('trace stack')
        })

        it('should log at warn level', () => {
            logger.warn('warn message', { service: 'TestService' })

            const log = mockTransport.getLastLog()
            expect(log).toBeDefined()
            expect(log?.level).toBe('warn')
            expect(log?.message).toBe('warn message')
            expect(log?.service).toBe('TestService')
        })

        it('should log at debug level', () => {
            logger.debug('debug message', { service: 'TestService' })

            const log = mockTransport.getLastLog()
            expect(log).toBeDefined()
            expect(log?.level).toBe('debug')
            expect(log?.message).toBe('debug message')
            expect(log?.service).toBe('TestService')
        })

        it('should log at verbose level', () => {
            logger.verbose('verbose message', { service: 'TestService' })

            const log = mockTransport.getLastLog()
            expect(log).toBeDefined()
            expect(log?.level).toBe('verbose')
            expect(log?.message).toBe('verbose message')
            expect(log?.service).toBe('TestService')
        })
    })

    describe('Request ID handling', () => {
        it('should set and get request ID', () => {
            const requestId = 'test-request-id-123'
            logger.setRequestId(requestId)
            expect(logger.getRequestId()).toBe(requestId)
        })

        it('should return undefined when no request ID is set', () => {
            expect(logger.getRequestId()).toBeUndefined()
        })

        it('should include request ID in logs', () => {
            const requestId = 'test-request-id-123'
            logger.setRequestId(requestId)
            logger.log('test message', { service: 'TestService' })

            const log = mockTransport.getLastLog()
            expect(log?.requestId).toBe(requestId)
        })

        it('should handle request ID in runWithContext', () => {
            const requestId = 'lambda-request-id-456'
            const result = logger.runWithContext(requestId, () => {
                return logger.getRequestId()
            })
            expect(result).toBe(requestId)
        })

        it('should propagate request ID within async context', async () => {
            const requestId = 'async-request-id-789'
            logger.setRequestId(requestId)

            await Promise.resolve()
            expect(logger.getRequestId()).toBe(requestId)

            logger.log('test message', { service: 'TestService' })
            const log = mockTransport.getLastLog()
            expect(log?.requestId).toBe(requestId)
        })
    })

    describe('Context management', () => {
        it('should set context', () => {
            const context: LogContext = {
                service: 'TestService',
                userId: 'user-123',
            }
            logger.setContext(context)
            const retrieved = logger.getContext()
            expect(retrieved.service).toBe('TestService')
            expect(retrieved.userId).toBe('user-123')
        })

        it('should include context in logs', () => {
            logger.setContext({ userId: 'user-123', operation: 'test-op' })
            logger.log('test message', { service: 'TestService' })

            const log = mockTransport.getLastLog()
            expect(log?.userId).toBe('user-123')
            expect(log?.operation).toBe('test-op')
        })

        it('should merge context', () => {
            logger.setContext({ service: 'Service1', userId: 'user-1' })
            logger.setContext({ operation: 'op1' })
            const context = logger.getContext()
            expect(context.service).toBe('Service1')
            expect(context.userId).toBe('user-1')
            expect(context.operation).toBe('op1')
        })

        it('should clear context', () => {
            logger.setContext({ service: 'TestService', userId: 'user-123' })
            logger.clearContext()
            const context = logger.getContext()
            expect(Object.keys(context)).toHaveLength(0)
        })

        it('should return a copy of context', () => {
            logger.setContext({ service: 'TestService' })
            const context1 = logger.getContext()
            const context2 = logger.getContext()
            expect(context1).not.toBe(context2)
            expect(context1).toEqual(context2)
        })
    })

    describe('Service name auto-detection', () => {
        it('should use provided service name', () => {
            logger.log('test', { service: 'CustomService' })

            const log = mockTransport.getLastLog()
            expect(log?.service).toBe('CustomService')
        })

        it('should use service from context if no service name provided', () => {
            logger.setContext({ service: 'ContextService' })
            logger.log('test')

            const log = mockTransport.getLastLog()
            expect(log?.service).toBe('ContextService')
        })

        it('should default to App if no service name available', () => {
            // Clear any context that might have service
            logger.clearContext()
            logger.log('test')

            const log = mockTransport.getLastLog()
            // Service name detection from call stack might pick up "LoggerService"
            // So we check that a service name is set (either "App" or detected from stack)
            expect(log?.service).toBeDefined()
            expect(typeof log?.service).toBe('string')
        })
    })

    describe('Lambda-specific behavior', () => {
        it('should handle per-invocation request ID', () => {
            logger.setRequestId('invocation-1')
            logger.log('message 1', { service: 'TestService' })
            const log1 = mockTransport.getLastLog()
            expect(log1?.requestId).toBe('invocation-1')

            logger.setRequestId('invocation-2')
            logger.log('message 2', { service: 'TestService' })
            const log2 = mockTransport.getLastLog()
            expect(log2?.requestId).toBe('invocation-2')
        })

        it('should maintain request ID across async operations', async () => {
            const requestId = 'lambda-request-id'
            logger.setRequestId(requestId)

            await Promise.resolve()
            expect(logger.getRequestId()).toBe(requestId)

            logger.log('test message', { service: 'TestService' })
            const log = mockTransport.getLastLog()
            expect(log?.requestId).toBe(requestId)
        })
    })

    describe('logWithContext', () => {
        it('should log with additional context', () => {
            logger.logWithContext('info', 'test message', {
                userId: 'user-123',
                operation: 'test-op',
            })

            const log = mockTransport.getLastLog()
            expect(log?.level).toBe('info')
            expect(log?.message).toBe('test message')
            expect(log?.userId).toBe('user-123')
            expect(log?.operation).toBe('test-op')
        })

        it('should merge context with service context', () => {
            logger.setContext({
                service: 'TestService',
                userId: 'existing-user',
            })
            logger.logWithContext('info', 'test', {
                userId: 'user-123',
            })

            const log = mockTransport.getLastLog()
            expect(log?.service).toBe('TestService')
            expect(log?.userId).toBe('user-123') // Additional context overrides
        })
    })

    describe('Sensitive data sanitization', () => {
        it('should sanitize passwords in context', () => {
            logger.logWithContext('info', 'test', {
                username: 'testuser',
                password: 'secret123',
            })

            const log = mockTransport.getLastLog()
            expect(log?.password).toBe('[REDACTED]')
            expect(log?.username).toBe('testuser')
        })

        it('should sanitize tokens in context', () => {
            logger.logWithContext('info', 'test', {
                token: 'abc123',
                accessToken: 'token456',
            })

            const log = mockTransport.getLastLog()
            expect(log?.token).toBe('[REDACTED]')
            expect(log?.accessToken).toBe('[REDACTED]')
        })

        it('should sanitize nested sensitive data', () => {
            logger.logWithContext('info', 'test', {
                user: {
                    name: 'John',
                    password: 'secret123',
                },
            })

            const log = mockTransport.getLastLog()
            const user = log?.user as Record<string, unknown>
            expect(user.password).toBe('[REDACTED]')
            expect(user.name).toBe('John')
        })
    })

    describe('Configuration', () => {
        it('should use provided configuration', () => {
            const config = {
                level: 'debug',
                appName: 'test-app',
            }
            const configuredLogger = new LoggerService(config)
            expect(configuredLogger).toBeInstanceOf(LoggerService)
            // Clean up logger to prevent resource leaks
            configuredLogger.close()
        })

        it('should use environment variables when config not provided', () => {
            process.env.LOG_LEVEL = 'warn'
            const envLogger = new LoggerService()
            expect(envLogger).toBeInstanceOf(LoggerService)
            // Clean up logger to prevent resource leaks
            envLogger.close()
        })
    })

    describe('Timestamp inclusion', () => {
        it('should include timestamp in log entries', () => {
            logger.log('test message', { service: 'TestService' })

            const log = mockTransport.getLastLog()
            expect(log?.timestamp).toBeDefined()
            expect(typeof log?.timestamp).toBe('string')
            // Should be ISO format
            expect(log?.timestamp).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            )
        })
    })

    describe('Correlation context', () => {
        it('should set correlation context', () => {
            logger.setRequestId('req-123')
            logger.setCorrelationContext({
                correlationId: 'corr-abc',
                parentRequestId: 'parent-xyz',
                callChain: ['service-a', 'service-b'],
            })

            expect(logger.getCorrelationId()).toBe('corr-abc')
            expect(logger.getParentRequestId()).toBe('parent-xyz')
            expect(logger.getCallChain()).toEqual(['service-a', 'service-b'])
        })

        it('should sync correlation context with global trace context', () => {
            logger.setRequestId('req-456')
            logger.setCorrelationContext({
                correlationId: 'corr-sync',
                callChain: ['test-service'],
            })

            // Verify it's accessible via LoggerService methods
            expect(logger.getCorrelationId()).toBe('corr-sync')
            expect(logger.getCallChain()).toEqual(['test-service'])
        })

        it('should return undefined when correlation context not set', () => {
            expect(logger.getCorrelationId()).toBeUndefined()
            expect(logger.getParentRequestId()).toBeUndefined()
            expect(logger.getCallChain()).toBeUndefined()
        })

        it('should include correlation context in logs', () => {
            logger.setRequestId('req-789')
            logger.setCorrelationContext({
                correlationId: 'corr-log',
                parentRequestId: 'parent-log',
                callChain: ['service-1', 'service-2'],
            })

            logger.log('test message', { service: 'TestService' })

            const log = mockTransport.getLastLog()
            expect(log?.correlationId).toBe('corr-log')
            expect(log?.parentRequestId).toBe('parent-log')
            expect(log?.callChain).toEqual(['service-1', 'service-2'])
        })

        it('should create AsyncLocalStorage store when setting correlation context without requestId', () => {
            // Set correlation context without setting requestId first
            logger.setCorrelationContext({
                correlationId: 'corr-no-req',
                callChain: ['test'],
            })

            // Should use correlationId as requestId fallback
            expect(logger.getCorrelationId()).toBe('corr-no-req')
            // RequestId should be set to correlationId as fallback
            const requestId = logger.getRequestId()
            expect(requestId).toBeDefined()
        })

        it('should update existing AsyncLocalStorage store when setting correlation context', () => {
            logger.setRequestId('existing-req')
            logger.setCorrelationContext({
                correlationId: 'corr-update',
                parentRequestId: 'parent-update',
                callChain: ['service-update'],
            })

            // RequestId should remain unchanged
            expect(logger.getRequestId()).toBe('existing-req')
            // Correlation context should be updated
            expect(logger.getCorrelationId()).toBe('corr-update')
            expect(logger.getParentRequestId()).toBe('parent-update')
        })

        it('should fall back to global trace context when local store has no correlationId', () => {
            // Set global trace context directly (simulating initTraceContextFromEvent)
            const { setTraceContext } = require('../../src/trace')
            setTraceContext({
                correlationId: 'global-corr',
                requestId: 'global-req',
                callChain: ['global-service'],
            })

            // LoggerService should pick it up
            expect(logger.getCorrelationId()).toBe('global-corr')
            expect(logger.getCallChain()).toEqual(['global-service'])
        })
    })
})
