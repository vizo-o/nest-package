// Set environment variables BEFORE any imports that might use them
process.env.APP_NAME = 'test-app'
process.env.ENV = 'test'

import { reportError } from '../../src/aws/report-error'
import { SmsService } from '../../src/aws/services'

// Mock AWS SDK
const mockSend = jest.fn()
jest.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => {
    return {
        PinpointSMSVoiceV2Client: jest.fn().mockImplementation(() => ({
            send: mockSend,
        })),
        SendTextMessageCommand: jest.fn().mockImplementation((params) => ({
            input: params,
        })),
    }
})

// Mock reportError
jest.mock('../../src/aws/report-error', () => ({
    reportError: jest.fn(),
}))

// Mock notify
jest.mock('../../src/aws/notify-inline', () => ({
    notify: jest.fn(),
    NotificationChannel: {
        ADMIN: 'ADMIN',
    },
}))

// Mock notify
jest.mock('../../src/aws/notify-inline', () => ({
    notify: jest.fn(),
    NotificationChannel: {
        ADMIN: 'ADMIN',
    },
}))

const mockReportError = reportError as jest.MockedFunction<typeof reportError>
const { notify } = require('../../src/aws/notify-inline')
const mockNotifyFn = notify as jest.MockedFunction<typeof notify>

describe('SmsService Error Reporting', () => {
    let service: SmsService

    beforeEach(() => {
        jest.clearAllMocks()
        mockReportError.mockResolvedValue(undefined)
        mockNotifyFn.mockResolvedValue(undefined)
        mockSend.mockReset()
        process.env.ENV = 'prod' // Default to prod for most tests
        service = new SmsService()
    })

    describe('non-prod send', () => {
        it('masks the number and keeps the message text in the log and admin email', async () => {
            process.env.ENV = 'dev'
            const logSpy = jest.spyOn(console, 'log').mockImplementation()

            await service.send({
                destinationNumber: '+972501234567',
                message: 'Your code is 123456',
                originationPhoneNumber: '+0987654321',
            })

            expect(mockSend).not.toHaveBeenCalled()
            const expected =
                'SMS not sent in non prod env, ***4567:\nYour code is 123456'
            expect(logSpy).toHaveBeenCalledWith(expected)
            expect(mockNotifyFn).toHaveBeenCalledWith(
                expect.objectContaining({ message: expected }),
            )
            expect(JSON.stringify(mockNotifyFn.mock.calls)).not.toContain(
                '972501234567',
            )

            logSpy.mockRestore()
        })
    })

    describe('SMS error notification uses reportError()', () => {
        it('should call reportError() when SMS sending fails in prod', async () => {
            process.env.ENV = 'prod'
            const error = new Error('SMS sending failed')
            mockSend.mockRejectedValue(error)

            await expect(
                service.send({
                    destinationNumber: '+1234567890',
                    message: 'Test message',
                    originationPhoneNumber: '+0987654321',
                }),
            ).rejects.toThrow()

            expect(mockReportError).toHaveBeenCalled()
            expect(mockNotifyFn).not.toHaveBeenCalled()
        })

        it('should mask the customer number in failure logs and alerts', async () => {
            process.env.ENV = 'prod'
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => undefined)
            mockSend.mockRejectedValue(
                new Error('Rejected for +1234567890 by carrier'),
            )

            await expect(
                service.send({
                    destinationNumber: '+1234567890',
                    message: 'Test message',
                    originationPhoneNumber: '+0987654321',
                }),
            ).rejects.toThrow()

            const logged = JSON.stringify(consoleError.mock.calls)
            const context = mockReportError.mock.calls[0][1]
            const getReportedMessage = () =>
                (mockReportError.mock.calls[0][0] as Error).message
            expect(logged).not.toContain('+1234567890')
            expect(logged).toContain('***7890')
            expect(context?.description).toContain('***7890')
            expect(JSON.stringify(context)).not.toContain('+1234567890')
            expect(getReportedMessage()).not.toContain('+1234567890')
            consoleError.mockRestore()
        })

        it('should use notify() in non-prod environments (not an error, just skipping SMS)', async () => {
            // In non-prod, SMS is skipped - this is NOT an error, so notify() is correct
            process.env.ENV = 'dev'

            await service.send({
                destinationNumber: '+1234567890',
                message: 'Test message',
                originationPhoneNumber: '+0987654321',
            })

            // Non-prod uses notify() for informational message, not reportError()
            expect(mockNotifyFn).toHaveBeenCalled()
            expect(mockReportError).not.toHaveBeenCalled()
            expect(mockSend).not.toHaveBeenCalled()
        })

        it('should NOT call reportError() when SMS sending succeeds', async () => {
            process.env.ENV = 'prod'
            mockSend.mockResolvedValue({
                MessageId: 'test-message-id',
            })

            await service.send({
                destinationNumber: '+1234567890',
                message: 'Test message',
                originationPhoneNumber: '+0987654321',
            })

            expect(mockReportError).not.toHaveBeenCalled()
        })
    })

    describe('error context includes destination and origination numbers', () => {
        it('should include the masked destination number in error context', async () => {
            process.env.ENV = 'prod'
            const error = new Error('SMS sending failed')
            mockSend.mockRejectedValue(error)

            await expect(
                service.send({
                    destinationNumber: '+1234567890',
                    message: 'Test message',
                    originationPhoneNumber: '+0987654321',
                }),
            ).rejects.toThrow()

            expect(mockReportError).toHaveBeenCalled()
            const callArgs = mockReportError.mock.calls[0]
            const errorContext = callArgs[1]

            expect(errorContext?.metadata?.destinationNumber).toBe('***7890')
            expect(errorContext?.metadata?.originationPhoneNumber).toBe(
                '+0987654321',
            )
        })

        it('should set correct severity and category for SMS errors', async () => {
            process.env.ENV = 'prod'
            const error = new Error('SMS sending failed')
            mockSend.mockRejectedValue(error)

            await expect(
                service.send({
                    destinationNumber: '+1234567890',
                    message: 'Test message',
                    originationPhoneNumber: '+0987654321',
                }),
            ).rejects.toThrow()

            expect(mockReportError).toHaveBeenCalled()
            const callArgs = mockReportError.mock.calls[0]
            const errorContext = callArgs[1]

            expect(errorContext?.severity).toBe('high')
            expect(errorContext?.category).toBe('external_service')
        })
    })
})
