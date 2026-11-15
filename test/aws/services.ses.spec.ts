process.env.APP_NAME = 'test-app'
process.env.ENV = 'test'

import { BlockedEmailError, SesService } from '../../src/aws/services'

const mockSesSend = jest.fn()
jest.mock('@aws-sdk/client-sesv2', () => ({
    SESv2Client: jest.fn().mockImplementation(() => ({ send: mockSesSend })),
    SendEmailCommand: jest.fn().mockImplementation((input) => ({ input })),
}))

const mockGetItem = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDB: jest.fn().mockImplementation(() => ({ getItem: mockGetItem })),
}))

jest.mock('@aws-sdk/client-ssm', () => ({
    SSMClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockResolvedValue({ Parameter: { Value: 'param' } }),
    })),
    GetParameterCommand: jest.fn().mockImplementation((input) => ({ input })),
}))

jest.mock('../../src/aws/report-error', () => ({
    reportError: jest.fn(),
}))

jest.mock('../../src/aws/notify-inline', () => ({
    notify: jest.fn(),
    NotificationChannel: { ADMIN: 'ADMIN' },
}))

/** Status table rows by address; an address with no row is active. */
function statuses(rows: Record<string, string>) {
    mockGetItem.mockImplementation(({ Key }) => {
        const status = rows[Key.email.S]
        return Promise.resolve(
            status ? { Item: { emailStatus: { S: status } } } : {},
        )
    })
}

const base = {
    from: 'sender@example.com',
    subject: 'Subject',
    htmlBody: '<p>Body</p>',
}

describe('SesService.sendEmail result', () => {
    let service: SesService

    beforeEach(() => {
        jest.clearAllMocks()
        mockSesSend.mockResolvedValue({})
        jest.spyOn(console, 'log').mockImplementation()
        jest.spyOn(console, 'warn').mockImplementation()
        jest.spyOn(console, 'error').mockImplementation()
        service = new SesService()
    })

    afterEach(() => jest.restoreAllMocks())

    it('reports sent when SES accepts the message', async () => {
        statuses({})

        const result = await service.sendEmail({
            ...base,
            to: ['a@example.com'],
        })

        expect(mockSesSend).toHaveBeenCalledTimes(1)
        expect(result).toEqual({
            sent: true,
            recipients: ['a@example.com'],
            skipped: [],
        })
    })

    it('reports not sent when the only recipient has a non-active status', async () => {
        statuses({ 'a@example.com': 'SUPPRESSED' })

        const result = await service.sendEmail({
            ...base,
            to: ['a@example.com'],
        })

        expect(mockSesSend).not.toHaveBeenCalled()
        expect(result).toEqual({
            sent: false,
            recipients: [],
            skipped: [{ email: 'a@example.com', status: 'SUPPRESSED' }],
        })
    })

    it('reports not sent when blocked recipients are dropped silently', async () => {
        statuses({ 'a@example.com': 'BOUNCED' })

        const result = await service.sendEmail({
            ...base,
            to: ['a@example.com'],
            silentDropBlockedRecipients: true,
        })

        expect(mockSesSend).not.toHaveBeenCalled()
        expect(result.sent).toBe(false)
        expect(result.skipped).toEqual([
            { email: 'a@example.com', status: 'BOUNCED' },
        ])
    })

    it('lists skipped recipients when the rest are sent', async () => {
        statuses({ 'b@example.com': 'COMPLAINED' })

        const result = await service.sendEmail({
            ...base,
            to: ['a@example.com', 'b@example.com'],
            silentDropBlockedRecipients: true,
        })

        expect(result).toEqual({
            sent: true,
            recipients: ['a@example.com'],
            skipped: [{ email: 'b@example.com', status: 'COMPLAINED' }],
        })
    })

    it('still throws for a bounced recipient when not dropping silently', async () => {
        statuses({ 'a@example.com': 'BOUNCED' })

        await expect(
            service.sendEmail({ ...base, to: ['a@example.com'] }),
        ).rejects.toBeInstanceOf(BlockedEmailError)
        expect(mockSesSend).not.toHaveBeenCalled()
    })

    it('still throws when SES rejects the message', async () => {
        statuses({})
        mockSesSend.mockRejectedValue(new Error('ses down'))

        await expect(
            service.sendEmail({ ...base, to: ['a@example.com'] }),
        ).rejects.toThrow('ses down')
    })
})
