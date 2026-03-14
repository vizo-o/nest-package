// Set environment variables BEFORE any imports that might use them
process.env.JWKS_URI = 'https://test.jwks.uri'
process.env.COGNITO_ISSUER = 'https://test.issuer'
process.env.COGNITO_AUDIENCE = 'test-audience'
process.env.SKIP_API = 'true' // Skip API validation for tests
process.env.APP_NAME = 'test-app'
process.env.ENV = 'test'

import type { LoggerService } from '@nestjs/common'
import type { ModuleRef } from '@nestjs/core'
import { ApiServiceBase } from '../../src/api/api.service'
import type { ApiDaoBase } from '../../src/api/api.dao'
import type { UserServiceBase } from '../../src/api/user.service'
import { HttpMethod } from '../../src/api/entities'
import type { RouteMetadata } from '../../src/api/entities'
import type { ApiResponse } from '../../src/api/entities'
import { LoggerService as NewLoggerService } from '../../src/logger-v2/logger.service'
import { createTestLogger } from '../utils/logger-test-helpers'

/**
 * Concrete test implementation of ApiServiceBase
 */
class TestApiService extends ApiServiceBase {
    readonly moduleRef: ModuleRef
    dao: ApiDaoBase
    userService: UserServiceBase
    controllerModules: never[] = []

    constructor(logger?: LoggerService) {
        super(logger)
        // Create minimal mocks for required dependencies
        this.moduleRef = {
            get: jest.fn(),
        } as unknown as ModuleRef
        this.dao = {
            createAccessLog: jest.fn(),
        } as unknown as ApiDaoBase
        this.userService = {
            checkUserAllowedToSignup: jest.fn(),
            getUserAuthorizationData: jest.fn(),
        } as unknown as UserServiceBase
    }
}

describe('ApiServiceBase Logger Integration', () => {
    let consoleLogSpy: jest.SpyInstance
    let consoleErrorSpy: jest.SpyInstance
    let consoleWarnSpy: jest.SpyInstance

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
    })

    afterEach(() => {
        consoleLogSpy.mockRestore()
        consoleErrorSpy.mockRestore()
        consoleWarnSpy.mockRestore()
    })

    describe('Logger injection', () => {
        it('should accept optional logger in constructor', () => {
            const mockLogger: LoggerService = {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }

            const service = new TestApiService(mockLogger)
            expect(service).toBeInstanceOf(ApiServiceBase)
        })

        it('should work without logger (backward compatibility)', () => {
            const service = new TestApiService()
            expect(service).toBeInstanceOf(ApiServiceBase)
        })
    })

    describe('Logging with logger provided', () => {
        it('should use logger.error when logger is provided', (done) => {
            const mockLogger: LoggerService = {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }

            const service = new TestApiService(mockLogger)

            // Trigger logMessage indirectly by calling a method that uses it
            // Since logMessage is private, we test through getJwk which calls it
            const header = { kid: 'test-kid' }
            const callback = jest.fn(() => {
                // Wait for async operations to complete
                setTimeout(() => {
                    expect(mockLogger.error).toHaveBeenCalled()
                    expect(console.error).not.toHaveBeenCalled()
                    done()
                }, 100)
            })
            // @ts-expect-error - accessing private method for testing
            service.getJwk(header, callback)
        })

        it('should use new LoggerService when provided', (done) => {
            const { logger, transport } = createTestLogger()
            const newLogger = new NewLoggerService()
            // Replace winston logger with test logger
            // @ts-expect-error - accessing private property for testing
            newLogger.winstonLogger = logger

            const service = new TestApiService(newLogger)

            const header = { kid: 'test-kid' }
            const callback = jest.fn(() => {
                setTimeout(() => {
                    // Should have logged error via new logger
                    const logs = transport.capturedLogs
                    const errorLogs = logs.filter(
                        (log) => log.level === 'error',
                    )
                    expect(errorLogs.length).toBeGreaterThan(0)
                    expect(console.error).not.toHaveBeenCalled()
                    newLogger.close()
                    done()
                }, 100)
            })
            // @ts-expect-error - accessing private method for testing
            service.getJwk(header, callback)
        })
    })

    describe('Fallback to console when no logger', () => {
        it('should use console.error when no logger provided', (done) => {
            const service = new TestApiService()

            const header = { kid: 'test-kid' }
            const callback = jest.fn(() => {
                setTimeout(() => {
                    // Should fall back to console.error
                    expect(console.error).toHaveBeenCalledWith(
                        'No matching key found in any JWKS client',
                    )
                    done()
                }, 100)
            })
            // @ts-expect-error - accessing private method for testing
            service.getJwk(header, callback)
        })

        it('should use console.warn when no logger provided', () => {
            const service = new TestApiService()

            // Test warn logging through addSingleControllerMapping
            const serviceInstance = {}
            const controllerName = 'TestController'
            const route: RouteMetadata<
                (params: unknown) => Promise<ApiResponse>
            > = {
                method: null as never, // This will trigger the warn
                path: '/test',
                httpMethod: HttpMethod.GET,
            }

            // @ts-expect-error - accessing private method for testing
            service.addSingleControllerMapping(
                serviceInstance,
                controllerName,
                route,
            )

            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    'Method not found in service for controller',
                ),
            )
        })
    })

    describe('Log levels', () => {
        it('should accept logger and store it for use', () => {
            const mockLogger: LoggerService = {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }

            const service = new TestApiService(mockLogger)

            // Verify logger is stored (tested indirectly through other tests)
            // The logger is used in getJwk, addSingleControllerMapping, etc.
            expect(service).toBeDefined()
            // We've already verified logger usage in other tests above
        })

        it('should call logger.error for error level messages', (done) => {
            const mockLogger: LoggerService = {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }

            const service = new TestApiService(mockLogger)

            const header = { kid: 'test-kid' }
            const callback = jest.fn(() => {
                setTimeout(() => {
                    expect(mockLogger.error).toHaveBeenCalledWith(
                        'No matching key found in any JWKS client',
                        undefined,
                        'ApiService',
                    )
                    done()
                }, 100)
            })
            // @ts-expect-error - accessing private method for testing
            service.getJwk(header, callback)
        })

        it('should call logger.warn for warn level messages', () => {
            const mockLogger: LoggerService = {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }

            const service = new TestApiService(mockLogger)

            const serviceInstance = {}
            const controllerName = 'TestController'
            const route: RouteMetadata<
                (params: unknown) => Promise<ApiResponse>
            > = {
                method: null as never,
                path: '/test',
                httpMethod: HttpMethod.GET,
            }

            // @ts-expect-error - accessing private method for testing
            service.addSingleControllerMapping(
                serviceInstance,
                controllerName,
                route,
            )

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    'Method not found in service for controller',
                ),
                'ApiService',
            )
        })
    })

    describe('Context handling', () => {
        it('should use default context "ApiService" when context not provided', (done) => {
            const mockLogger: LoggerService = {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }

            const service = new TestApiService(mockLogger)

            const header = { kid: 'test-kid' }
            const callback = jest.fn(() => {
                setTimeout(() => {
                    expect(mockLogger.error).toHaveBeenCalledWith(
                        expect.any(String),
                        undefined,
                        'ApiService',
                    )
                    done()
                }, 100)
            })
            // @ts-expect-error - accessing private method for testing
            service.getJwk(header, callback)
        })
    })
})
