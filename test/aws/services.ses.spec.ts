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

describe('SesService.sendEmail result (prod)', () => {
    let service: SesService

    beforeEach(() => {
        process.env.ENV = 'prod'
        jest.clearAllMocks()
        mockSesSend.mockResolvedValue({})
        jest.spyOn(console, 'log').mockImplementation()
        jest.spyOn(console, 'warn').mockImplementation()
        jest.spyOn(console, 'error').mockImplementation()
        service = new SesService()
    })

    afterEach(() => {
        process.env.ENV = 'test'
        jest.restoreAllMocks()
    })

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

/** The SendEmailCommand input of the n-th SES call. */
const sentInput = (n = 0) => mockSesSend.mock.calls[n][0].input

describe('SesService.sendEmail recipients by environment', () => {
    let service: SesService
    const saved = { ...process.env }

    beforeEach(() => {
        jest.clearAllMocks()
        mockSesSend.mockResolvedValue({})
        statuses({})
        jest.spyOn(console, 'log').mockImplementation()
        jest.spyOn(console, 'warn').mockImplementation()
        delete process.env.SES_NON_PROD_ALLOWED_RECIPIENTS
        delete process.env.SES_NON_PROD_SINK
        delete process.env.DEV_EMAIL_FROM
        service = new SesService()
    })

    afterEach(() => {
        process.env = { ...saved }
        jest.restoreAllMocks()
    })

    it('prod sends to the real recipients from the real sender, unchanged', async () => {
        process.env.ENV = 'prod'
        process.env.SES_NON_PROD_SINK = 'dev@vizo-o.com'

        const result = await service.sendEmail({
            ...base,
            to: ['customer@example.com', 'staff@vizo-o.com'],
        })

        expect(mockSesSend).toHaveBeenCalledTimes(1)
        expect(sentInput().FromEmailAddress).toBe('sender@example.com')
        expect(sentInput().Destination.ToAddresses).toEqual([
            'customer@example.com',
            'staff@vizo-o.com',
        ])
        expect(result).toEqual({
            sent: true,
            recipients: ['customer@example.com', 'staff@vizo-o.com'],
            skipped: [],
        })
    })

    it.each(['dev', 'staging', 'local', 'test', 'production', 'PROD'])(
        'ENV=%s never reaches a real recipient',
        async (env) => {
            process.env.ENV = env

            const result = await service.sendEmail({
                ...base,
                to: ['customer@example.com'],
            })

            expect(sentInput().Destination.ToAddresses).toEqual([
                'success@simulator.amazonses.com',
            ])
            expect(sentInput().FromEmailAddress).toBe('dev@vizo-o.com')
            expect(result.recipients).toEqual([
                'success@simulator.amazonses.com',
            ])
        },
    )

    it('a missing ENV counts as non-prod', async () => {
        delete process.env.ENV

        await service.sendEmail({ ...base, to: ['customer@example.com'] })

        expect(sentInput().Destination.ToAddresses).toEqual([
            'success@simulator.amazonses.com',
        ])
    })

    it('keeps allowlisted test mailboxes and redirects the rest once', async () => {
        process.env.ENV = 'dev'

        await service.sendEmail({
            ...base,
            to: [
                'Dev@vizo-o.com',
                'gilaade+lead@vizo-o.com',
                'carmel@vizo-o.com',
                'customer@example.com',
                'bounce@simulator.amazonses.com',
            ],
        })

        expect(sentInput().Destination.ToAddresses).toEqual([
            'Dev@vizo-o.com',
            'gilaade+lead@vizo-o.com',
            'bounce@simulator.amazonses.com',
            'success@simulator.amazonses.com',
        ])
    })

    it('logs what was redirected, with masked addresses', async () => {
        process.env.ENV = 'dev'

        await service.sendEmail({ ...base, to: ['customer@example.com'] })

        const line = (console.log as jest.Mock).mock.calls
            .map(([first]) => String(first))
            .find((text) => text.includes('ses_redirected_non_prod'))
        expect(line).toBeDefined()
        expect(JSON.parse(line as string)).toMatchObject({
            event: 'ses_redirected_non_prod',
            env: 'dev',
            redirected: ['c***@example.com'],
            sink: 'success@simulator.amazonses.com',
        })
        expect(line).not.toContain('customer@example.com')
    })

    it('honours an extra allowlist and an allowlisted sink', async () => {
        process.env.ENV = 'dev'
        process.env.SES_NON_PROD_ALLOWED_RECIPIENTS =
            'qa@example.com, @test.vizo-o.com'
        process.env.SES_NON_PROD_SINK = 'dev@vizo-o.com'

        await service.sendEmail({
            ...base,
            to: ['qa@example.com', 'x@test.vizo-o.com', 'real@example.com'],
        })

        expect(sentInput().Destination.ToAddresses).toEqual([
            'qa@example.com',
            'x@test.vizo-o.com',
            'dev@vizo-o.com',
        ])
    })

    it('ignores a sink that is not a test mailbox', async () => {
        process.env.ENV = 'dev'
        process.env.SES_NON_PROD_SINK = 'someone@example.com'

        await service.sendEmail({ ...base, to: ['customer@example.com'] })

        expect(sentInput().Destination.ToAddresses).toEqual([
            'success@simulator.amazonses.com',
        ])
    })
})
