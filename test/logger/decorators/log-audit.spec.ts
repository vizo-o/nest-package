import winston from 'winston'
import { LogAudit } from '../../../src/logger-v2/decorators/log-audit.decorator'
import { LoggerService } from '../../../src/logger-v2/logger.service'
import type { LogContext } from '../../../src/logger-v2/types'

// Mock Winston transports
jest.mock('../../../src/logger-v2/transports/dev.transport', () => ({
    createDevTransport: jest.fn(() => {
        return new winston.transports.Console()
    }),
}))

jest.mock('../../../src/logger-v2/transports/cloudwatch.transport', () => ({
    createCloudWatchTransport: jest.fn(() => null),
}))

describe('LogAudit decorator', () => {
    let logger: LoggerService
    let logSpy: jest.SpyInstance

    beforeEach(() => {
        logger = new LoggerService()
        logSpy = jest.spyOn(logger, 'logWithContext')
    })

    afterEach(() => {
        jest.clearAllMocks()
        // Close logger to prevent resource leaks
        if (logger) {
            try {
                logger.close()
            } catch {
                // Ignore errors during cleanup
            }
        }
    })

    describe('Audit log format', () => {
        it('should log audit events for successful operations', async () => {
            class TestService {
                @LogAudit(logger, 'USER_LOGIN')
                login(): Promise<string> {
                    return Promise.resolve('success')
                }
            }

            const service = new TestService()
            await service.login()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[0]).toBe('info')
            expect(call[1]).toContain('Audit: USER_LOGIN')
            expect(call[2]).toHaveProperty('auditType', 'USER_LOGIN')
            expect(call[2]).toHaveProperty('operation')
        })

        it('should log audit errors for failed operations', async () => {
            class TestService {
                @LogAudit(logger, 'USER_LOGIN')
                login(): Promise<never> {
                    return Promise.reject(new Error('Login failed'))
                }
            }

            const service = new TestService()
            await expect(service.login()).rejects.toThrow()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[0]).toBe('error')
            expect(call[1]).toContain('Audit error: USER_LOGIN')
            expect(call[2]).toHaveProperty('error')
        })
    })

    describe('Context capture', () => {
        it('should include additional context', async () => {
            const additionalContext: LogContext = {
                userId: 'user-123',
                ipAddress: '192.168.1.1',
            }

            class TestService {
                @LogAudit(logger, 'USER_ACTION', additionalContext)
                async performAction(): Promise<void> {
                    // Empty method
                }
            }

            const service = new TestService()
            await service.performAction()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[2]).toHaveProperty('userId', 'user-123')
            expect(call[2]).toHaveProperty('ipAddress', '192.168.1.1')
        })

        it('should include operation name in context', async () => {
            class TestService {
                @LogAudit(logger, 'CONFIG_CHANGE')
                async updateConfig(): Promise<void> {
                    // Empty method
                }
            }

            const service = new TestService()
            await service.updateConfig()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[2]).toHaveProperty(
                'operation',
                'TestService.updateConfig',
            )
        })
    })

    describe('Security-sensitive operation logging', () => {
        it('should log password changes', async () => {
            class UserService {
                @LogAudit(logger, 'PASSWORD_CHANGE')
                async changePassword(): Promise<void> {
                    // Empty method
                }
            }

            const service = new UserService()
            await service.changePassword()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[2]).toHaveProperty('auditType', 'PASSWORD_CHANGE')
        })

        it('should log permission changes', async () => {
            class PermissionService {
                @LogAudit(logger, 'PERMISSION_CHANGE')
                async updatePermissions(): Promise<void> {
                    // Empty method
                }
            }

            const service = new PermissionService()
            await service.updatePermissions()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[2]).toHaveProperty('auditType', 'PERMISSION_CHANGE')
        })

        it('should log data deletion', async () => {
            class DataService {
                @LogAudit(logger, 'DATA_DELETION')
                async deleteData(): Promise<void> {
                    // Empty method
                }
            }

            const service = new DataService()
            await service.deleteData()

            expect(logSpy).toHaveBeenCalled()
            const call = logSpy.mock.calls[0]
            expect(call[2]).toHaveProperty('auditType', 'DATA_DELETION')
        })
    })
})
