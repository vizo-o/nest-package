import { LogPerformance } from '../../../src/logger-v2/decorators/log-performance.decorator'
import { LoggerService } from '../../../src/logger-v2/logger.service'
import winston from 'winston'

// Mock Winston transports
jest.mock('../../../src/logger-v2/transports/dev.transport', () => ({
    createDevTransport: jest.fn(() => {
        return new winston.transports.Console()
    }),
}))

jest.mock('../../../src/logger-v2/transports/cloudwatch.transport', () => ({
    createCloudWatchTransport: jest.fn(() => null),
}))

describe('LogPerformance decorator', () => {
    let logger: LoggerService
    let logSpy: jest.SpyInstance

    beforeEach(() => {
        // Create a fresh logger instance for each test to avoid state pollution
        logger = new LoggerService()
        logSpy = jest.spyOn(logger, 'logWithContext')
    })

    afterEach(() => {
        // Clean up spies and clear any timers
        logSpy.mockRestore()
        jest.clearAllMocks()
        jest.clearAllTimers()
        // Close logger to prevent resource leaks
        if (logger) {
            try {
                logger.close()
            } catch {
                // Ignore errors during cleanup
            }
        }
    })

    describe('Timing measurement', () => {
        it('should log performance metrics for async methods', async () => {
            class TestService {
                @LogPerformance(logger)
                async testMethod(): Promise<string> {
                    await new Promise((resolve) => setTimeout(resolve, 10))

                    return 'result'
                }
            }

            const service = new TestService()
            await service.testMethod()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[0]).toBe('info')
            expect(call[1]).toContain('Performance:')
            expect(call[2]).toHaveProperty('operation')
            expect(call[2]).toHaveProperty('duration')
            expect(call[2]).toHaveProperty('unit', 'ms')
        })

        it('should measure execution time', async () => {
            jest.useFakeTimers()
            try {
                class TestService {
                    @LogPerformance(logger)
                    async slowMethod(): Promise<void> {
                        await new Promise((resolve) => {
                            setTimeout(resolve, 50)
                        })
                    }
                }

                const service = new TestService()
                const done = service.slowMethod()
                await jest.advanceTimersByTimeAsync(50)
                await done

                expect(logSpy).toHaveBeenCalled()
                const call = logSpy.mock.calls[0]
                const duration = (call[2] as { duration: number }).duration
                expect(duration).toBe(50)
            } finally {
                jest.useRealTimers()
            }
        })
    })

    describe('Error handling', () => {
        it('should log error performance when method throws', async () => {
            class TestService {
                @LogPerformance(logger)
                failingMethod(): Promise<never> {
                    return Promise.reject(new Error('Test error'))
                }
            }

            const service = new TestService()
            await expect(service.failingMethod()).rejects.toThrow('Test error')

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[0]).toBe('error')
            expect(call[1]).toContain('Performance error:')
            expect(call[2]).toHaveProperty('error')
        })

        it('should include duration even on error', async () => {
            class TestService {
                @LogPerformance(logger)
                async failingMethod(): Promise<never> {
                    await new Promise((resolve) => setTimeout(resolve, 10))
                    throw new Error('Test error')
                }
            }

            const service = new TestService()
            await expect(service.failingMethod()).rejects.toThrow()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[2]).toHaveProperty('duration')
        })
    })

    describe('Log output format', () => {
        it('should include method name in log', async () => {
            class TestService {
                @LogPerformance(logger)
                async testMethod(): Promise<void> {
                    // Empty method
                }
            }

            const service = new TestService()
            await service.testMethod()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[1]).toContain('TestService.testMethod')
        })

        it('should include operation name', async () => {
            class TestService {
                @LogPerformance(logger)
                async testMethod(): Promise<void> {
                    // Empty method
                }
            }

            const service = new TestService()
            await service.testMethod()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[2]).toHaveProperty(
                'operation',
                'TestService.testMethod',
            )
        })
    })
})
