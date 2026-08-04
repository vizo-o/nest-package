import { EventHandler, Schedule } from '../../src/event/event.decorator'
import { EventServiceBase } from '../../src/event/event.service'
import { createScheduleEventKey } from '../../src/event/entities'

describe('@Schedule enabledEnvs on shared cron keys', () => {
    const sharedCron = '0 2 * * *'
    const sharedEventKey = createScheduleEventKey(sharedCron)

    @EventHandler()
    class SharedCronProbeService {
        @Schedule(sharedCron, { enabledEnvs: ['prod'] })
        async prodOnlyOnSharedCron() {
            return { statusCode: 200, message: 'prod-shared' }
        }

        @Schedule(sharedCron)
        async everyEnvOnSharedCron() {
            return { statusCode: 200, message: 'open-shared' }
        }
    }

    class ProbeEventService extends EventServiceBase<{ type: string }> {
        readonly moduleRef = { get: jest.fn() } as never
        readonly module = {} as never
        readonly dao = { createEventLog: jest.fn() } as never
    }

    beforeEach(() => {
        void SharedCronProbeService
    })

    it('includes shared cron in dev when any handler is env-agnostic', () => {
        process.env.ENV = 'dev'
        const service = new ProbeEventService()

        expect(service.getScheduleCrons()).toContain(sharedEventKey)
    })

    it('binds only env-eligible handlers on a shared cron key', async () => {
        process.env.ENV = 'dev'

        const service = new ProbeEventService()
        const sharedService = new SharedCronProbeService()
        service.eventSubscriptions[sharedEventKey] = []

        service['bindMethodToEvent'](
            sharedService,
            Object.getPrototypeOf(sharedService),
            'prodOnlyOnSharedCron',
        )
        service['bindMethodToEvent'](
            sharedService,
            Object.getPrototypeOf(sharedService),
            'everyEnvOnSharedCron',
        )

        expect(service.eventSubscriptions[sharedEventKey]).toHaveLength(1)

        const result = await service.eventSubscriptions[sharedEventKey]?.[0]?.(
            {} as { type: string },
        )
        expect(result).toEqual({ statusCode: 200, message: 'open-shared' })
    })
})
