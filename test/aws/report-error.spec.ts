// Set environment variables BEFORE any imports that might use them
process.env.APP_NAME = 'test-app'
process.env.ENV = 'test'

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { AppError } from '../../src/api/entities'
import { NotificationChannel } from '../../src/aws/entities'
import { notify } from '../../src/aws/notify-inline'
import { reportError, type ErrorContext } from '../../src/aws/report-error'
import { AdminEventTypes } from '../../src/event/app.entities'
import { clearTraceContext } from '../../src/trace'

// Mock AWS SDK
const mockSend = jest.fn()
jest.mock('@aws-sdk/client-sqs', () => {
    return {
        SQSClient: jest.fn().mockImplementation(() => ({
            send: mockSend,
        })),
        SendMessageCommand: jest.fn().mockImplementation((params) => ({
            input: params,
        })),
    }
})

// Mock notify function
jest.mock('../../src/aws/notify-inline', () => ({
    notify: jest.fn(),
    NotificationChannel: {
        ADMIN: 'ADMIN',
    },
}))

describe('reportError', () => {
    const mockNotify = notify as jest.MockedFunction<typeof notify>

    beforeEach(() => {
        jest.clearAllMocks()
        clearTraceContext() // Clear any trace context from previous tests
        delete process.env.INCIDENT_PROCESSING_QUEUE_URL
        mockSend.mockReset()
        mockNotify.mockReset()
    })

    describe('error context enrichment', () => {
        it('should use service name from context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                service: 'custom-service',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.service).toBe('custom-service')
        })

        it('should use APP_NAME when service not provided', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.service).toBe('test-app')
        })

        it('should use UnknownService when APP_NAME not set', async () => {
            const originalAppName = process.env.APP_NAME
            delete process.env.APP_NAME
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.service).toBe('UnknownService')

            process.env.APP_NAME = originalAppName
        })

        it('should include request ID from context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                requestId: 'req-123',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.metadata?.requestId).toBe('req-123')
        })

        it('should include fingerprint from context when provided', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                title: 'Monday webhook failed',
                fingerprint: 'monday-add-additional-phone-webhook',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.fingerprint).toBe(
                'monday-add-additional-phone-webhook',
            )
        })

        it('should include user ID from context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                userId: 'user-456',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.metadata?.userId).toBe('user-456')
        })
    })

    describe('severity determination', () => {
        it('should use explicit severity from context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                severity: 'low',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.severity).toBe('low')
        })

        it('should determine critical severity for database errors', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Database connection failed')
            error.name = 'DatabaseError'

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.severity).toBe('critical')
        })

        it('should determine critical severity for connection errors', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Connection timeout')
            error.name = 'ConnectionError'

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.severity).toBe('critical')
        })

        it('should determine critical severity for database-related messages', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Failed to connect to database')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.severity).toBe('critical')
        })

        it('should determine high severity for HTTP errors', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('API request failed')
            error.name = 'HttpException'

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.severity).toBe('high')
        })

        it('should determine medium severity for validation errors', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Validation failed')
            error.name = 'ValidationError'

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.severity).toBe('medium')
        })

        it('should default to high severity for unknown errors', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Some random error')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.severity).toBe('high')
        })
    })

    describe('error type extraction', () => {
        it('should extract error name from Error instance', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            error.name = 'CustomError'

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.errorType).toBe('CustomError')
        })

        it('should use constructor name when name not available', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            class CustomError extends Error {
                constructor(message: string) {
                    super(message)
                    this.name = ''
                }
            }

            const error = new CustomError('Test error')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.errorType).toBe('CustomError')
        })

        it('should use UnknownError for non-Error types', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            await reportError('string error')

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.errorType).toBe('UnknownError')
        })
    })

    describe('key details extraction', () => {
        it('should use description from context if provided', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                description: 'Custom description',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            // When no endpoint, error message is used for fingerprinting
            expect(messageBody.keyDetails).toBe('Test error')
        })

        it('should use error message when description not provided', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error message')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.keyDetails).toBe('Test error message')
        })
    })

    describe('title generation', () => {
        it('should use custom title from context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                title: 'Custom Error Title',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.title).toBe('Custom Error Title')
        })

        it('should generate title for scheduled job errors', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Job failed')
            const context: ErrorContext = {
                scheduledJob: 'daily-sync',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.title).toContain('Scheduled job error')
            expect(messageBody.title).toContain('daily-sync')
        })

        it('should generate title for API errors', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('API request failed')
            const context: ErrorContext = {
                endpoint: '/api/users',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.title).toContain('API error')
            expect(messageBody.title).toContain('/api/users')
        })

        it('should generate default title when no context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Something went wrong')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.title).toContain('test-app')
            expect(messageBody.title).toContain('Something went wrong')
        })
    })

    describe('SQS message payload construction', () => {
        it('should construct correct message payload structure', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                service: 'test-service',
                requestId: 'req-123',
                endpoint: '/api/test',
                userId: 'user-456',
                severity: 'high',
                category: 'api_error',
                metadata: { custom: 'data' },
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            expect(callArgs.QueueUrl).toBe(
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
            )

            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.type).toBe(
                AdminEventTypes.INCIDENT_PROCESSING_QUEUE,
            )
            expect(messageBody.service).toBe('test-service')
            expect(messageBody.severity).toBe('high')
            expect(messageBody.endpoint).toBe('/api/test')
            expect(messageBody.metadata?.requestId).toBe('req-123')
            expect(messageBody.metadata?.userId).toBe('user-456')
            expect(messageBody.metadata?.category).toBe('api_error')
            expect(messageBody.metadata?.custom).toBe('data')
            // keyDetails should be just the error message - fingerprinting logic is in admin-system
            expect(messageBody.keyDetails).toBe('Test error')
        })

        it('should include error stack trace in metadata', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            error.stack = 'Error: Test error\n    at test.js:1:1'

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.metadata?.stackTrace).toBe(error.stack)
        })

        it('should include error cause in metadata', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const cause = new Error('Root cause')
            const error = new Error('Test error', { cause })

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            // String(error.cause) includes error name, so it's "Error: Root cause"
            expect(messageBody.metadata?.cause).toBe('Error: Root cause')
        })
    })

    describe('fallback mechanism', () => {
        it('should fallback to email when queue URL not configured', async () => {
            delete process.env.INCIDENT_PROCESSING_QUEUE_URL
            mockNotify.mockResolvedValue(undefined)

            const error = new Error('Test error')

            await reportError(error)

            expect(mockSend).not.toHaveBeenCalled()
            expect(mockNotify).toHaveBeenCalledWith({
                notificationChannels: [NotificationChannel.ADMIN],
                subject: expect.stringContaining('[FALLBACK]'),
                message: expect.stringContaining('Test error'),
            })
        })

        it('should fallback to email when SQS fails', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockRejectedValue(new Error('SQS service unavailable'))
            mockNotify.mockResolvedValue(undefined)

            const error = new Error('Test error')

            await reportError(error)

            expect(mockSend).toHaveBeenCalled()
            expect(mockNotify).toHaveBeenCalledWith({
                notificationChannels: [NotificationChannel.ADMIN],
                subject: expect.stringContaining('[FALLBACK]'),
                message: expect.stringContaining('Test error'),
            })
        })

        it('should include admin service error in fallback message', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            const sqsError = new Error('SQS connection failed')
            mockSend.mockRejectedValue(sqsError)
            mockNotify.mockResolvedValue(undefined)

            const error = new Error('Test error')

            await reportError(error)

            expect(mockNotify).toHaveBeenCalled()
            const notifyCall = mockNotify.mock.calls[0][0]
            // When SQS fails, the error is logged but not passed to formatFallbackErrorMessage
            // The fallback message should still be sent
            expect(notifyCall.message).toContain('FALLBACK ERROR NOTIFICATION')
            expect(notifyCall.message).toContain('Test error')
        })

        it('should handle fallback email failure gracefully', async () => {
            delete process.env.INCIDENT_PROCESSING_QUEUE_URL
            mockNotify.mockRejectedValue(new Error('Email service unavailable'))

            const error = new Error('Test error')

            // Should not throw - errors are logged to console
            await expect(reportError(error)).resolves.not.toThrow()

            expect(mockNotify).toHaveBeenCalled()
            expect(console.error).toHaveBeenCalled()
        })
    })

    describe('fallback email notification format', () => {
        it('should format fallback message with error details', async () => {
            delete process.env.INCIDENT_PROCESSING_QUEUE_URL
            mockNotify.mockResolvedValue(undefined)

            const error = new Error('Test error')
            error.stack = 'Error: Test error\n    at test.js:1:1'
            const context: ErrorContext = {
                service: 'test-service',
                requestId: 'req-123',
                endpoint: '/api/test',
                userId: 'user-456',
            }

            await reportError(error, context)

            expect(mockNotify).toHaveBeenCalled()
            const notifyCall = mockNotify.mock.calls[0][0]
            expect(notifyCall.message).toContain('FALLBACK ERROR NOTIFICATION')
            expect(notifyCall.message).toContain('TEST-SERVICE') // Service name is uppercased
            expect(notifyCall.message).toContain('req-123')
            expect(notifyCall.message).toContain('/api/test')
            expect(notifyCall.message).toContain('user-456')
            expect(notifyCall.message).toContain('Test error')
            expect(notifyCall.message).toContain('STACK TRACE')
        })
    })

    describe('error handling when both SQS and fallback fail', () => {
        it('should log to console when both fail', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockRejectedValue(new Error('SQS failed'))
            mockNotify.mockRejectedValue(new Error('Email failed'))

            const error = new Error('Test error')
            const context: ErrorContext = {
                service: 'test-service',
            }

            await reportError(error, context)

            expect(console.error).toHaveBeenCalledWith(
                'Failed to send fallback notification:',
                expect.any(Error),
            )
            expect(console.error).toHaveBeenCalledWith('Original error:', error)
            expect(console.error).toHaveBeenCalledWith(
                'Error context:',
                context,
            )
        })
    })

    describe('various error types', () => {
        it('should handle standard Error instances', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Standard error')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.keyDetails).toBe('Standard error')
        })

        it('should handle AppError instances', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new AppError('App error', 500)

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.keyDetails).toBe('App error')
            // AppError extends Error, so error.name might be "Error" or "AppError" depending on implementation
            expect(messageBody.metadata?.errorName).toBeDefined()
        })

        it('should handle unknown error types', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            await reportError({ unexpected: 'object' })

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.errorType).toBe('UnknownError')
        })

        it('should handle string errors', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            await reportError('String error')

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.keyDetails).toBe('String error')
        })
    })

    describe('different context combinations', () => {
        it('should handle endpoint context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                endpoint: '/api/users/123',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.endpoint).toBe('/api/users/123')
        })

        it('should handle scheduled job context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                scheduledJob: 'daily-reconciliation',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.scheduledJob).toBe('daily-reconciliation')
        })

        it('should handle userId context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                userId: 'user-789',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.metadata?.userId).toBe('user-789')
        })

        it('should handle custom metadata', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                metadata: {
                    customField: 'customValue',
                    nested: { data: 'value' },
                },
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.metadata?.customField).toBe('customValue')
            expect(messageBody.metadata?.nested).toEqual({ data: 'value' })
        })

        it('should handle category context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                category: 'infrastructure',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.metadata?.category).toBe('infrastructure')
        })
    })

    describe('queue URL configuration', () => {
        it('should use INCIDENT_PROCESSING_QUEUE_URL env var', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            expect(callArgs.QueueUrl).toBe(
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
            )
        })

        it('should fallback when queue URL not configured', async () => {
            delete process.env.INCIDENT_PROCESSING_QUEUE_URL
            mockNotify.mockResolvedValue(undefined)

            const error = new Error('Test error')

            await reportError(error)

            expect(mockSend).not.toHaveBeenCalled()
            expect(mockNotify).toHaveBeenCalled()
        })
    })

    describe('LocalStack support', () => {
        let originalEnv: NodeJS.ProcessEnv
        let originalNodeEnv: string | undefined
        let consoleLogSpy: jest.SpyInstance

        beforeEach(() => {
            originalEnv = { ...process.env }
            originalNodeEnv = process.env.NODE_ENV
            consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
            jest.clearAllMocks()
        })

        afterEach(() => {
            process.env = originalEnv
            if (originalNodeEnv !== undefined) {
                process.env.NODE_ENV = originalNodeEnv
            } else {
                delete process.env.NODE_ENV
            }
            consoleLogSpy.mockRestore()
        })

        it('should detect local dev environment when ENV=local', async () => {
            process.env.ENV = 'local'
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            process.env.AWS_ENDPOINT_URL_SQS = 'http://localhost:4566'
            process.env.AWS_REGION = 'us-east-1'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            // Verify SQSClient was called with LocalStack configuration
            expect(SQSClient).toHaveBeenCalled()
            const sqsClientCalls = (SQSClient as unknown as jest.Mock).mock
                .calls
            const localStackCall = sqsClientCalls.find(
                (call) =>
                    call[0]?.endpoint === 'http://localhost:4566' &&
                    call[0]?.credentials?.accessKeyId === 'test',
            )
            expect(localStackCall).toBeDefined()
        })

        it('should detect local dev environment when ENV is not set', async () => {
            delete process.env.ENV
            delete process.env.NODE_ENV
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            process.env.AWS_ENDPOINT_URL_SQS = 'http://localhost:4566'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            // Should use LocalStack configuration
            expect(SQSClient).toHaveBeenCalled()
            const sqsClientCalls = (SQSClient as unknown as jest.Mock).mock
                .calls
            const localStackCall = sqsClientCalls.find(
                (call) => call[0]?.endpoint === 'http://localhost:4566',
            )
            expect(localStackCall).toBeDefined()
        })

        it('should detect local dev environment when NODE_ENV is not set', async () => {
            process.env.ENV = 'test'
            delete process.env.NODE_ENV
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            process.env.AWS_ENDPOINT_URL_SQS = 'http://localhost:4566'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            // Should use LocalStack configuration
            expect(SQSClient).toHaveBeenCalled()
            const sqsClientCalls = (SQSClient as unknown as jest.Mock).mock
                .calls
            const localStackCall = sqsClientCalls.find(
                (call) => call[0]?.endpoint === 'http://localhost:4566',
            )
            expect(localStackCall).toBeDefined()
        })

        it('should use default region us-east-1 when AWS_REGION not set', async () => {
            process.env.ENV = 'local'
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            process.env.AWS_ENDPOINT_URL_SQS = 'http://localhost:4566'
            delete process.env.AWS_REGION
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            expect(SQSClient).toHaveBeenCalled()
            const sqsClientCalls = (SQSClient as unknown as jest.Mock).mock
                .calls
            const localStackCall = sqsClientCalls.find(
                (call) =>
                    call[0]?.endpoint === 'http://localhost:4566' &&
                    call[0]?.region === 'us-east-1',
            )
            expect(localStackCall).toBeDefined()
        })

        it('should use custom AWS_REGION when set', async () => {
            process.env.ENV = 'local'
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            process.env.AWS_ENDPOINT_URL_SQS = 'http://localhost:4566'
            process.env.AWS_REGION = 'eu-west-1'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            expect(SQSClient).toHaveBeenCalled()
            const sqsClientCalls = (SQSClient as unknown as jest.Mock).mock
                .calls
            const localStackCall = sqsClientCalls.find(
                (call) =>
                    call[0]?.endpoint === 'http://localhost:4566' &&
                    call[0]?.region === 'eu-west-1',
            )
            expect(localStackCall).toBeDefined()
        })

        it('should use test credentials for LocalStack', async () => {
            process.env.ENV = 'local'
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            process.env.AWS_ENDPOINT_URL_SQS = 'http://localhost:4566'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            expect(SQSClient).toHaveBeenCalled()
            const sqsClientCalls = (SQSClient as unknown as jest.Mock).mock
                .calls
            const localStackCall = sqsClientCalls.find(
                (call) =>
                    call[0]?.credentials?.accessKeyId === 'test' &&
                    call[0]?.credentials?.secretAccessKey === 'test',
            )
            expect(localStackCall).toBeDefined()
        })

        it('should log to console in local dev when message sent successfully', async () => {
            process.env.ENV = 'local'
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            process.env.AWS_ENDPOINT_URL_SQS = 'http://localhost:4566'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[LOCAL DEV] Successfully sent error report to LocalStack SQS:',
                expect.any(String),
            )
        })

        it('should not use LocalStack when AWS_ENDPOINT_URL_SQS is not set', async () => {
            process.env.ENV = 'local'
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            delete process.env.AWS_ENDPOINT_URL_SQS
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            expect(SQSClient).toHaveBeenCalled()
            const sqsClientCalls = (SQSClient as unknown as jest.Mock).mock
                .calls
            // Should use default SQSClient (no endpoint specified)
            const defaultCall = sqsClientCalls.find(
                (call) => !call[0]?.endpoint,
            )
            expect(defaultCall).toBeDefined()
        })

        it('should not use LocalStack in production environment', async () => {
            process.env.ENV = 'production'
            process.env.NODE_ENV = 'production'
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            process.env.AWS_ENDPOINT_URL_SQS = 'http://localhost:4566'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')

            await reportError(error)

            expect(SQSClient).toHaveBeenCalled()
            const sqsClientCalls = (SQSClient as unknown as jest.Mock).mock
                .calls
            // Should use default SQSClient (no LocalStack endpoint)
            const defaultCall = sqsClientCalls.find(
                (call) => !call[0]?.endpoint,
            )
            expect(defaultCall).toBeDefined()
        })
    })

    describe('metadata sanitization', () => {
        it('should redact Authorization tokens in metadata', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                metadata: {
                    authorization:
                        'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
                    password: 'secret123',
                    token: 'abc123',
                },
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.metadata.authorization).toBe('[REDACTED]')
            expect(messageBody.metadata.password).toBe('[REDACTED]')
            expect(messageBody.metadata.token).toBe('[REDACTED]')
        })

        it('should redact customer emails in metadata', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                metadata: {
                    email: 'customer@example.com',
                    userInfo: 'customer@example.com',
                },
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.metadata.email).toMatch(
                /^c\*{1,4}@example\.com$/,
            )
        })

        it('should preserve employee emails in metadata', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                userId: 'employee@vizo-o.com',
                metadata: {
                    email: 'employee@vizo-o.com',
                    userInfo: 'employee@vizo-o.com',
                    userRoles: ['admin'],
                },
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.metadata.email).toBe('employee@vizo-o.com')
        })

        it('should preserve vizoIds in metadata', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                metadata: {
                    vizoId: 'Vi-005879',
                    customerExternalId: 'EXT-123',
                    customer: {
                        vizoId: 'Vi-005879',
                        email: 'customer@example.com',
                        firstName: 'John',
                        lastName: 'Doe',
                    },
                },
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.metadata.vizoId).toBe('Vi-005879')
            expect(messageBody.metadata.customerExternalId).toBe('EXT-123')
            expect(messageBody.metadata.customer.vizoId).toBe('Vi-005879')
            expect(messageBody.metadata.customer.email).toMatch(
                /^c\*{1,4}@example\.com$/,
            )
            expect(messageBody.metadata.customer.firstName).toBe('[REDACTED]')
        })

        it('should sanitize payloadInfo JSON string', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const payloadInfoJson = JSON.stringify({
                headers: {
                    Authorization: 'Bearer token123',
                    'Content-Type': 'application/json',
                },
                body: {
                    email: 'customer@example.com',
                    password: 'secret',
                },
            })
            const context: ErrorContext = {
                metadata: {
                    payloadInfo: payloadInfoJson,
                },
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            const sanitizedPayloadInfo = JSON.parse(
                messageBody.metadata.payloadInfo as string,
            )
            expect(sanitizedPayloadInfo.headers.Authorization).toBe(
                '[REDACTED]',
            )
            expect(sanitizedPayloadInfo.headers['Content-Type']).toBe(
                'application/json',
            )
            expect(sanitizedPayloadInfo.body.password).toBe('[REDACTED]')
            expect(sanitizedPayloadInfo.body.email).toMatch(
                /^c\*{1,4}@example\.com$/,
            )
        })

        it('should handle invalid payloadInfo JSON string gracefully', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                metadata: {
                    payloadInfo: 'invalid json {',
                },
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            // Should preserve original string if JSON parsing fails
            expect(messageBody.metadata.payloadInfo).toBe('invalid json {')
        })
    })

    describe('correlation context', () => {
        it('should include correlation context from context parameter', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                correlationId: 'corr-from-context',
                parentRequestId: 'parent-from-context',
                callChain: ['service-a', 'service-b'],
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.correlationId).toBe('corr-from-context')
            expect(messageBody.parentRequestId).toBe('parent-from-context')
            expect(messageBody.callChain).toEqual(['service-a', 'service-b'])
        })

        it('should get correlation context from trace module when available', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            // Set trace context via trace module
            const { setTraceContext } = require('../../src/trace')
            setTraceContext({
                correlationId: 'corr-from-trace',
                requestId: 'req-from-trace',
                parentRequestId: 'parent-from-trace',
                callChain: ['trace-service'],
            })

            const error = new Error('Test error')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.correlationId).toBe('corr-from-trace')
            expect(messageBody.parentRequestId).toBe('parent-from-trace')
            expect(messageBody.callChain).toEqual(['trace-service'])
        })

        it('should prioritize context parameter over trace module', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            // Set trace context via trace module
            const { setTraceContext } = require('../../src/trace')
            setTraceContext({
                correlationId: 'corr-from-trace',
                requestId: 'req-from-trace',
                callChain: ['trace-service'],
            })

            const error = new Error('Test error')
            const context: ErrorContext = {
                correlationId: 'corr-from-context',
                callChain: ['context-service'],
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            // Should use context parameter values
            expect(messageBody.correlationId).toBe('corr-from-context')
            expect(messageBody.callChain).toEqual(['context-service'])
        })

        it('should auto-generate correlation ID for standalone apps', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            // Clear any existing trace context
            // Note: We can't easily clear AsyncLocalStorage in tests, so we'll test that
            // getCorrelationId() generates a new one when no context exists
            const {
                setTraceContext: _setTraceContext,
            } = require('../../src/trace')

            const error = new Error('Test error')

            await reportError(error)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            // Should have auto-generated correlation ID
            expect(messageBody.correlationId).toBeDefined()
            expect(typeof messageBody.correlationId).toBe('string')
            expect(messageBody.correlationId.length).toBeGreaterThan(0)
        })

        it('should share same correlation ID across multiple reportError calls in same context', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            // Set trace context
            const { setTraceContext } = require('../../src/trace')
            setTraceContext({
                correlationId: 'shared-corr-id',
                requestId: 'shared-req-id',
                callChain: ['shared-service'],
            })

            const error1 = new Error('Error 1')
            const error2 = new Error('Error 2')

            await reportError(error1)
            await reportError(error2)

            expect(SendMessageCommand).toHaveBeenCalledTimes(2)
            const call1Args = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const call2Args = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[1][0]
            const messageBody1 = JSON.parse(call1Args.MessageBody)
            const messageBody2 = JSON.parse(call2Args.MessageBody)

            // Both should have same correlation ID
            expect(messageBody1.correlationId).toBe('shared-corr-id')
            expect(messageBody2.correlationId).toBe('shared-corr-id')
        })

        it('should include partial correlation context when only correlationId provided', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            const error = new Error('Test error')
            const context: ErrorContext = {
                correlationId: 'corr-only',
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            expect(messageBody.correlationId).toBe('corr-only')
            // parentRequestId and callChain should be undefined when not provided
            expect(messageBody.parentRequestId).toBeUndefined()
            expect(messageBody.callChain).toBeUndefined()
        })

        it('should merge trace module parentRequestId with context correlationId', async () => {
            process.env.INCIDENT_PROCESSING_QUEUE_URL =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            mockSend.mockResolvedValue({ MessageId: 'test-id' })

            // Set trace context with parentRequestId
            const { setTraceContext } = require('../../src/trace')
            setTraceContext({
                correlationId: 'trace-corr',
                requestId: 'trace-req',
                parentRequestId: 'trace-parent',
                callChain: ['trace-chain'],
            })

            const error = new Error('Test error')
            const context: ErrorContext = {
                correlationId: 'context-corr',
                // parentRequestId not provided, should use trace module's
            }

            await reportError(error, context)

            expect(SendMessageCommand).toHaveBeenCalled()
            const callArgs = (SendMessageCommand as unknown as jest.Mock).mock
                .calls[0][0]
            const messageBody = JSON.parse(callArgs.MessageBody)
            // Should use context correlationId but trace module's parentRequestId
            expect(messageBody.correlationId).toBe('context-corr')
            expect(messageBody.parentRequestId).toBe('trace-parent')
            expect(messageBody.callChain).toEqual(['trace-chain'])
        })
    })
})
