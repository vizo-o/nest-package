// Set environment variables BEFORE any imports that might use them
process.env.APP_NAME = 'test-app'
process.env.ENV = 'test'

import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { SQSService } from '../../src/aws/services'

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

describe('SQSService', () => {
    let service: SQSService

    beforeEach(() => {
        jest.clearAllMocks()
        service = new SQSService()
    })

    describe('constructor', () => {
        it('should create SQSClient instance', () => {
            expect(SQSClient).toHaveBeenCalledWith({})
            expect(service).toBeInstanceOf(SQSService)
        })

        it('should expose client property', () => {
            expect(service.client).toBeDefined()
            expect(service.client.send).toBeDefined()
        })
    })

    describe('sendMessage', () => {
        it('should send message to SQS queue', async () => {
            const queueUrl =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            const messageBody = JSON.stringify({ test: 'data' })

            mockSend.mockResolvedValue({
                MessageId: 'test-message-id',
            })

            await service.sendMessage(queueUrl, messageBody)

            expect(SendMessageCommand).toHaveBeenCalledWith({
                QueueUrl: queueUrl,
                MessageBody: messageBody,
            })
            expect(mockSend).toHaveBeenCalledTimes(1)
        })

        it('should handle string message body', async () => {
            const queueUrl =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            const messageBody = 'simple string message'

            mockSend.mockResolvedValue({
                MessageId: 'test-message-id',
            })

            await service.sendMessage(queueUrl, messageBody)

            expect(SendMessageCommand).toHaveBeenCalledWith({
                QueueUrl: queueUrl,
                MessageBody: messageBody,
            })
        })

        it('should handle JSON message body', async () => {
            const queueUrl =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            const messageBody = JSON.stringify({
                incidentId: 'incident-123',
                timestamp: '2024-01-01T00:00:00Z',
            })

            mockSend.mockResolvedValue({
                MessageId: 'test-message-id',
            })

            await service.sendMessage(queueUrl, messageBody)

            expect(SendMessageCommand).toHaveBeenCalledWith({
                QueueUrl: queueUrl,
                MessageBody: messageBody,
            })
        })

        it('should propagate errors from AWS SDK', async () => {
            const queueUrl =
                'https://sqs.us-east-1.amazonaws.com/123456789/test-queue'
            const messageBody = 'test message'
            const error = new Error('AWS SQS error')

            mockSend.mockRejectedValue(error)

            await expect(
                service.sendMessage(queueUrl, messageBody),
            ).rejects.toThrow('AWS SQS error')
        })

        it('should handle different queue URLs', async () => {
            const queueUrls = [
                'https://sqs.us-east-1.amazonaws.com/123456789/queue-1',
                'https://sqs.us-west-2.amazonaws.com/987654321/queue-2',
                'https://sqs.eu-west-1.amazonaws.com/111222333/queue-3',
            ]

            mockSend.mockResolvedValue({
                MessageId: 'test-message-id',
            })

            for (const queueUrl of queueUrls) {
                await service.sendMessage(queueUrl, 'test message')
                expect(SendMessageCommand).toHaveBeenCalledWith({
                    QueueUrl: queueUrl,
                    MessageBody: 'test message',
                })
            }

            expect(mockSend).toHaveBeenCalledTimes(queueUrls.length)
        })
    })
})
