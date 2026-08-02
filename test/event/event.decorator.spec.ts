import { EventHandler, Schedule } from '../../src/event/event.decorator'
import { EventServiceBase } from '../../src/event/event.service'
import { createScheduleEventKey } from '../../src/event/entities'

describe('@Schedule enabledEnvs', () => {
    const prodCron = '0 5 * * *'
    const prodEventKey = createScheduleEventKey(prodCron)
    const openCron = '*/3 * * * *'
    const openEventKey = createScheduleEventKey(openCron)

    @EventHandler()
    class ScheduleProbeService {
        @Schedule(prodCron, { enabledEnvs: ['prod'] })
        async prodOnlyJob() {
            return { statusCode: 200, message: 'prod' }
        }

        @Schedule(openCron)
        async everyEnvJob() {
            return { statusCode: 200, message: 'open' }
        }
    }

    class ProbeEventService extends EventServiceBase<{ type: string }> {
        readonly moduleRef = { get: jest.fn() } as never
        readonly module = {} as never
        readonly dao = { createEventLog: jest.fn() } as never
    }

    beforeEach(() => {
        void ScheduleProbeService
    })

    it('registers prod-only schedules regardless of ENV at import time', () => {
        process.env.ENV = 'ci'
        const service = new ProbeEventService()

        expect(service.getScheduleCrons()).toEqual([openEventKey])
    })

    it('includes prod-only schedules when ENV=prod during discovery', () => {
        process.env.ENV = 'prod'
        const service = new ProbeEventService()

        expect(service.getScheduleCrons().sort()).toEqual(
            [openEventKey, prodEventKey].sort(),
        )
    })
})
