import { isInternalHealthApiEvent, isInternalHealthPath } from '../../src/lambda/health'
import { isSmokeTestEvent, runSmokeTest } from '../../src/lambda/smoke'

describe('lambda smoke helpers', () => {
    it('detects SMOKE_TEST operational events', () => {
        expect(isSmokeTestEvent({ type: 'SMOKE_TEST', environment: 'dev' })).toBe(
            true,
        )
        expect(isSmokeTestEvent({ type: 'SCHEDULE' })).toBe(false)
    })

    it('runSmokeTest returns 200 with service name', async () => {
        const result = await runSmokeTest(
            {} as Parameters<typeof runSmokeTest>[0],
            { serviceName: 'clinical-system' },
        )
        expect(result.statusCode).toBe(200)
        expect(JSON.parse(result.body)).toMatchObject({
            status: 'ok',
            service: 'clinical-system',
        })
    })
})

describe('lambda health helpers', () => {
    it('matches internal health paths', () => {
        expect(isInternalHealthPath('/health/internal')).toBe(true)
        expect(isInternalHealthPath('/health/internal/')).toBe(true)
        expect(isInternalHealthPath('/v1/health')).toBe(false)
    })

    it('detects API Gateway health events', () => {
        expect(
            isInternalHealthApiEvent({
                httpMethod: 'GET',
                path: '/health/internal',
                headers: {},
            }),
        ).toBe(true)
    })
})
