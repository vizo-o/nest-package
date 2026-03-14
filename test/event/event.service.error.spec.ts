// Set environment variables BEFORE any imports that might use them
process.env.APP_NAME = 'test-app'
process.env.ENV = 'test'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

import type { LoggerService } from '@nestjs/common'
import type { ModuleRef } from '@nestjs/core'
import type { Module } from '@nestjs/core/injector/module'
import type { EventDaoBase } from '../../src/event/event.dao'
import { EventServiceBase } from '../../src/event/event.service'
import {
    createScheduleEventKey,
    EventBaseTypes,
    type ScheduleEvent,
} from '../../src/event/entities'

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

describe('EventServiceBase Error Handling', () => {
    let service: TestEventService
    let mockLogger: LoggerService

    beforeEach(() => {
        jest.clearAllMocks()

        mockLogger = {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            verbose: jest.fn(),
        }

        service = new TestEventService(mockLogger)
    })

    describe('scheduled job error propagation', () => {
        it('should propagate error when scheduled job handler throws', async () => {
            const cron = '0 0 * * *'
            const scheduledEvent: ScheduleEvent = {
                type: EventBaseTypes.SCHEDULE,
                cron,
            }
            const eventKey = createScheduleEventKey(cron)

            // Mock event subscription to throw error
            service.eventSubscriptions[eventKey] = [
                jest.fn().mockRejectedValue(new Error('Scheduled job failed')),
            ]

            await expect(service.handleEvent(scheduledEvent)).rejects.toThrow(
                'Scheduled job failed',
            )
        })

        it('should propagate AppError from scheduled job', async () => {
            const cron = '0 0 * * *'
            const scheduledEvent: ScheduleEvent = {
                type: EventBaseTypes.SCHEDULE,
                cron,
            }
            const eventKey = createScheduleEventKey(cron)

            const appError = new Error('App error')
            appError.name = 'AppError'
            service.eventSubscriptions[eventKey] = [
                jest.fn().mockRejectedValue(appError),
            ]

            await expect(service.handleEvent(scheduledEvent)).rejects.toThrow(
                appError,
            )
        })

        it('should propagate standard Error from scheduled job', async () => {
            const cron = '0 */6 * * *'
            const scheduledEvent: ScheduleEvent = {
                type: EventBaseTypes.SCHEDULE,
                cron,
            }
            const eventKey = createScheduleEventKey(cron)

            const error = new Error('Standard error')
            service.eventSubscriptions[eventKey] = [
                jest.fn().mockRejectedValue(error),
            ]

            await expect(service.handleEvent(scheduledEvent)).rejects.toThrow(
                error,
            )
        })
    })

    describe('error propagation for all event types', () => {
        it('should propagate errors from regular event handlers', async () => {
            const regularEvent = {
                type: 'TEST_EVENT',
            }

            const error = new Error('Handler failed')
            service.eventSubscriptions['TEST_EVENT'] = [
                jest.fn().mockRejectedValue(error),
            ]

            await expect(service.handleEvent(regularEvent)).rejects.toThrow(
                error,
            )
        })

        it('should propagate errors from scheduled job handlers', async () => {
            const cron = '0 0 * * *'
            const scheduledEvent: ScheduleEvent = {
                type: EventBaseTypes.SCHEDULE,
                cron,
            }
            const eventKey = createScheduleEventKey(cron)

            const error = new Error('Scheduled job failed')
            service.eventSubscriptions[eventKey] = [
                jest.fn().mockRejectedValue(error),
            ]

            await expect(service.handleEvent(scheduledEvent)).rejects.toThrow(
                error,
            )
        })
    })

    describe('getImportedModules null safety', () => {
        it('should handle undefined imports metadata gracefully', () => {
            // Mock module with no imports metadata
            jest.spyOn(Reflect, 'getMetadata').mockReturnValue(undefined)

            // Should not throw when accessing importedModules
            expect(() => {
                service.onModuleInit()
            }).not.toThrow()

            jest.restoreAllMocks()
        })

        it('should handle non-array imports metadata gracefully', () => {
            // Mock module with non-array imports
            jest.spyOn(Reflect, 'getMetadata')
                .mockReturnValueOnce({ notAnArray: true })
                .mockReturnValue(undefined)

            // Should not throw
            expect(() => {
                service.onModuleInit()
            }).not.toThrow()

            jest.restoreAllMocks()
        })

        it('should handle array imports correctly', () => {
            const mockModule1 = {} as unknown as Module
            const mockModule2 = {} as unknown as Module
            jest.spyOn(Reflect, 'getMetadata')
                .mockReturnValueOnce([mockModule1, mockModule2])
                .mockReturnValue(undefined)

            // Should process modules without error
            expect(() => {
                service.onModuleInit()
            }).not.toThrow()

            jest.restoreAllMocks()
        })
    })

    describe('preProcessEvent SQS type inference', () => {
        it('should infer NOTIFICATION_QUEUE type from queue ARN when type not present', async () => {
            const sqsEvent = {
                Records: [
                    {
                        eventSource: 'aws:sqs',
                        eventSourceARN:
                            'arn:aws:sqs:us-east-1:123456789:my-notification-queue',
                        body: JSON.stringify({
                            message: 'test notification',
                        }),
                    },
                ],
            }

            // Subscribe to the inferred event type
            service.eventSubscriptions['NOTIFICATION_QUEUE'] = [
                jest.fn().mockResolvedValue({ statusCode: 200 }),
            ]

            await service.handleEvent(sqsEvent)

            // Verify handler was called with correct event type
            const handler = service.eventSubscriptions[
                'NOTIFICATION_QUEUE'
            ][0] as jest.Mock
            expect(handler).toHaveBeenCalled()
            const callArgs = handler.mock.calls[0][0]
            expect(callArgs).toHaveProperty('type', 'NOTIFICATION_QUEUE')
            expect(callArgs).toHaveProperty('message', 'test notification')
        })

        it('should infer LIFECYCLE_QUEUE type from queue ARN when type not present', async () => {
            const sqsEvent = {
                Records: [
                    {
                        eventSource: 'aws:sqs',
                        eventSourceARN:
                            'arn:aws:sqs:us-east-1:123456789:my-lifecycle-queue',
                        body: JSON.stringify({
                            action: 'create',
                        }),
                    },
                ],
            }

            // Subscribe to the inferred event type
            service.eventSubscriptions['LIFECYCLE_QUEUE'] = [
                jest.fn().mockResolvedValue({ statusCode: 200 }),
            ]

            await service.handleEvent(sqsEvent)

            // Verify handler was called with correct event type
            const handler = service.eventSubscriptions[
                'LIFECYCLE_QUEUE'
            ][0] as jest.Mock
            expect(handler).toHaveBeenCalled()
            const callArgs = handler.mock.calls[0][0]
            expect(callArgs).toHaveProperty('type', 'LIFECYCLE_QUEUE')
            expect(callArgs).toHaveProperty('action', 'create')
        })

        it('should use explicit type when present in message body', async () => {
            const sqsEvent = {
                Records: [
                    {
                        eventSource: 'aws:sqs',
                        eventSourceARN:
                            'arn:aws:sqs:us-east-1:123456789:my-notification-queue',
                        body: JSON.stringify({
                            type: 'CUSTOM_EVENT',
                            data: 'test',
                        }),
                    },
                ],
            }

            // Subscribe to the explicit event type
            service.eventSubscriptions['CUSTOM_EVENT'] = [
                jest.fn().mockResolvedValue({ statusCode: 200 }),
            ]

            await service.handleEvent(sqsEvent)

            // Verify handler was called with explicit type, not inferred
            const handler = service.eventSubscriptions[
                'CUSTOM_EVENT'
            ][0] as jest.Mock
            expect(handler).toHaveBeenCalled()
            const callArgs = handler.mock.calls[0][0]
            expect(callArgs).toHaveProperty('type', 'CUSTOM_EVENT')
            expect(callArgs).toHaveProperty('data', 'test')
        })

        it('should handle SQS events without queue ARN', async () => {
            const sqsEvent = {
                Records: [
                    {
                        eventSource: 'aws:sqs',
                        eventSourceARN: '',
                        body: JSON.stringify({
                            type: 'TEST_EVENT',
                        }),
                    },
                ],
            }

            service.eventSubscriptions['TEST_EVENT'] = [
                jest.fn().mockResolvedValue({ statusCode: 200 }),
            ]

            await service.handleEvent(sqsEvent)

            const handler = service.eventSubscriptions[
                'TEST_EVENT'
            ][0] as jest.Mock
            expect(handler).toHaveBeenCalled()
            const callArgs = handler.mock.calls[0][0]
            expect(callArgs).toHaveProperty('type', 'TEST_EVENT')
        })

        it('should handle queue name case insensitivity', async () => {
            const sqsEvent = {
                Records: [
                    {
                        eventSource: 'aws:sqs',
                        eventSourceARN:
                            'arn:aws:sqs:us-east-1:123456789:MY-NOTIFICATION-QUEUE',
                        body: JSON.stringify({
                            message: 'test',
                        }),
                    },
                ],
            }

            service.eventSubscriptions['NOTIFICATION_QUEUE'] = [
                jest.fn().mockResolvedValue({ statusCode: 200 }),
            ]

            await service.handleEvent(sqsEvent)

            // Should match case-insensitively
            const handler = service.eventSubscriptions[
                'NOTIFICATION_QUEUE'
            ][0] as jest.Mock
            expect(handler).toHaveBeenCalled()
            const callArgs = handler.mock.calls[0][0]
            expect(callArgs).toHaveProperty('type', 'NOTIFICATION_QUEUE')
        })

        it('should not infer type for queues that do not match patterns', async () => {
            const sqsEvent = {
                Records: [
                    {
                        eventSource: 'aws:sqs',
                        eventSourceARN:
                            'arn:aws:sqs:us-east-1:123456789:regular-queue',
                        body: JSON.stringify({
                            data: 'test',
                        }),
                    },
                ],
            }

            // Event without type should fail to find handler
            await expect(service.handleEvent(sqsEvent)).rejects.toThrow()
        })
    })
})
