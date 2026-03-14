import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { LoggerModule } from '../../src/logger-v2/logger.module'
import { LoggerService } from '../../src/logger-v2/logger.service'
import winston from 'winston'

// Mock Winston transports
jest.mock('../../src/logger-v2/transports/dev.transport', () => ({
    createDevTransport: jest.fn(() => {
        return new winston.transports.Console()
    }),
}))

jest.mock('../../src/logger-v2/transports/cloudwatch.transport', () => ({
    createCloudWatchTransport: jest.fn(() => null),
}))

describe('LoggerModule', () => {
    let module: TestingModule
    let loggerService: LoggerService

    beforeEach(async () => {
        module = await Test.createTestingModule({
            imports: [LoggerModule],
        }).compile()

        loggerService = module.get<LoggerService>(LoggerService)
    })

    afterEach(async () => {
        // Close logger to prevent resource leaks
        if (loggerService) {
            try {
                loggerService.close()
            } catch {
                // Ignore errors during cleanup
            }
        }
        await module.close()
    })

    describe('Module registration', () => {
        it('should be defined', () => {
            expect(module).toBeDefined()
        })

        it('should export LoggerService', () => {
            expect(loggerService).toBeDefined()
            expect(loggerService).toBeInstanceOf(LoggerService)
        })
    })

    describe('Dependency injection', () => {
        it('should inject LoggerService', () => {
            const injected = module.get<LoggerService>(LoggerService)
            expect(injected).toBe(loggerService)
        })

        it('should be a singleton', () => {
            const instance1 = module.get<LoggerService>(LoggerService)
            const instance2 = module.get<LoggerService>(LoggerService)
            expect(instance1).toBe(instance2)
        })
    })

    describe('Global module behavior', () => {
        it('should be available globally when imported', async () => {
            const testModule = await Test.createTestingModule({
                imports: [LoggerModule],
                providers: [
                    {
                        provide: 'TestService',
                        useFactory: (logger: LoggerService) => {
                            expect(logger).toBeInstanceOf(LoggerService)

                            return { logger }
                        },
                        inject: [LoggerService],
                    },
                ],
            }).compile()

            const testService = testModule.get('TestService')
            expect(testService.logger).toBeInstanceOf(LoggerService)

            // Clean up logger before closing module
            const testLogger = testModule.get<LoggerService>(LoggerService)
            testLogger.close()
            await testModule.close()
        })
    })
})
