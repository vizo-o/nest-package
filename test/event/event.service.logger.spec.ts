// Set environment variables BEFORE any imports that might use them
process.env.APP_NAME = 'test-app'
process.env.ENV = 'test'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

import type { LoggerService } from '@nestjs/common'
import type { ModuleRef } from '@nestjs/core'
import type { Module } from '@nestjs/core/injector/module'
import type { EventDaoBase } from '../../src/event/event.dao'
import { EventServiceBase } from '../../src/event/event.service'
import { LoggerService as NewLoggerService } from '../../src/logger-v2/logger.service'
import { createTestLogger } from '../utils/logger-test-helpers'

/**
 * Concrete test implementation of EventServiceBase
 */
class TestEventService extends EventServiceBase<{ type: string }> {
    readonly moduleRef: ModuleRef
    readonly module: Module
    readonly dao: EventDaoBase

    constructor(logger?: LoggerService) {
        super(logger)
        // Create minimal mocks for required dependencies
        this.moduleRef = {
            get: jest.fn(),
        } as unknown as ModuleRef
        this.module = {} as unknown as Module
        this.dao = {
            createEventLog: jest.fn().mockResolvedValue({ id: 'test-log-id' }),
            createFileRecord: jest
                .fn()
                .mockResolvedValue({ id: 'test-file-id' }),
            updateFileRecord: jest
                .fn()
                .mockResolvedValue({ id: 'test-file-id' }),
            getFileRecordFromKey: jest.fn().mockResolvedValue({
                id: 'test-file-id',
                status: 'pending',
            }),
        } as unknown as EventDaoBase
    }
}

describe('EventServiceBase Logger Integration', () => {
    let consoleLogSpy: jest.SpyInstance
    let consoleErrorSpy: jest.SpyInstance
    let consoleWarnSpy: jest.SpyInstance

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
    })

    afterEach(() => {
        consoleLogSpy.mockRestore()
        consoleErrorSpy.mockRestore()
        consoleWarnSpy.mockRestore()
    })

    describe('Logger injection', () => {
        it('should accept optional logger in constructor', () => {
            const mockLogger: LoggerService = {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }

            const service = new TestEventService(mockLogger)
            expect(service).toBeInstanceOf(EventServiceBase)
        })

        it('should work without logger (backward compatibility)', () => {
            const service = new TestEventService()
            expect(service).toBeInstanceOf(EventServiceBase)
        })
    })

    describe('Logging with logger provided', () => {
        it('should use logger.log when logger is provided', async () => {
            const mockLogger: LoggerService = {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }

            const service = new TestEventService(mockLogger)

            // Trigger logMessage indirectly by calling handleEvent
            const testEvent = { type: 'TEST_EVENT' }
            // Mock event subscriptions to avoid error
            service.eventSubscriptions['TEST_EVENT'] = [
                jest.fn().mockResolvedValue({
                    statusCode: 200,
                    message: 'Success',
                }),
            ]

            await service.handleEvent(testEvent)

            expect(mockLogger.log).toHaveBeenCalledWith(
                expect.stringContaining('Handling event'),
                'EventService',
            )
            expect(console.log).not.toHaveBeenCalled()
        })

        it('should use new LoggerService when provided', async () => {
            const { logger, transport } = createTestLogger()
            const newLogger = new NewLoggerService()
            // Replace winston logger with test logger
            // @ts-expect-error - accessing private property for testing
            newLogger.winstonLogger = logger

            const service = new TestEventService(newLogger)

            const testEvent = { type: 'TEST_EVENT' }
            service.eventSubscriptions['TEST_EVENT'] = [
                jest.fn().mockResolvedValue({
                    statusCode: 200,
                    message: 'Success',
                }),
            ]

            await service.handleEvent(testEvent)

            // Should have logged via new logger
            const logs = transport.capturedLogs
            const infoLogs = logs.filter((log) => log.level === 'info')
            expect(infoLogs.length).toBeGreaterThan(0)
            expect(console.log).not.toHaveBeenCalled()
            newLogger.close()
        })
    })

    describe('Fallback to console when no logger', () => {
        it('should use console.log when no logger provided', async () => {
            const service = new TestEventService()

            const testEvent = { type: 'TEST_EVENT' }
            service.eventSubscriptions['TEST_EVENT'] = [
                jest.fn().mockResolvedValue({
                    statusCode: 200,
                    message: 'Success',
                }),
            ]

            await service.handleEvent(testEvent)

            // Should fall back to console.log
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('Handling event'),
            )
        })

        it('should use console.log for S3 test events when no logger', async () => {
            const service = new TestEventService()

            // S3 test events need to match the format expected by isS3TestEvent
            // It expects: { event: { Records: [{ body: JSON.stringify({ Service: 'Amazon S3', Event: 's3:TestEvent' }) }] } }
            const s3TestEvent = {
                event: {
                    Records: [
                        {
                            body: JSON.stringify({
                                Service: 'Amazon S3',
                                Event: 's3:TestEvent',
                            }),
                        },
                    ],
                },
            }

            const result = await service.handleEvent(s3TestEvent)

            expect(result).toEqual([
                { statusCode: 200, message: 'S3 test event received' },
            ])
            expect(console.log).toHaveBeenCalledWith('S3 test event received')
        })
    })

    describe('Log levels', () => {
        it('should call logger.log for log level messages', async () => {
            const mockLogger: LoggerService = {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }

            const service = new TestEventService(mockLogger)

            const testEvent = { type: 'TEST_EVENT' }
            service.eventSubscriptions['TEST_EVENT'] = [
                jest.fn().mockResolvedValue({
                    statusCode: 200,
                    message: 'Success',
                }),
            ]

            await service.handleEvent(testEvent)

            expect(mockLogger.log).toHaveBeenCalledWith(
                expect.stringContaining('Handling event'),
                'EventService',
            )
        })
    })

    describe('Context handling', () => {
        it('should use default context "EventService" when context not provided', async () => {
            const mockLogger: LoggerService = {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }

            const service = new TestEventService(mockLogger)

            const testEvent = { type: 'TEST_EVENT' }
            service.eventSubscriptions['TEST_EVENT'] = [
                jest.fn().mockResolvedValue({
                    statusCode: 200,
                    message: 'Success',
                }),
            ]

            await service.handleEvent(testEvent)

            expect(mockLogger.log).toHaveBeenCalledWith(
                expect.any(String),
                'EventService',
            )
        })
    })
})
