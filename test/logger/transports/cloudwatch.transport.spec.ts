import { createCloudWatchTransport } from '../../../src/logger-v2/transports/cloudwatch.transport'
import type { LoggerConfig } from '../../../src/logger-v2/types'
import WinstonCloudwatch from 'winston-cloudwatch'

// Mock winston-cloudwatch
const mockWinstonCloudwatch = jest.fn().mockImplementation(() => ({
    log: jest.fn(),
}))

jest.mock('winston-cloudwatch', () => {
    return jest.fn().mockImplementation((config) => {
        return mockWinstonCloudwatch(config)
    })
})

// Mock AWS SDK
jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
    CloudWatchLogs: jest.fn().mockImplementation(() => ({})),
}))

describe('CloudWatchTransport', () => {
    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
        originalEnv = { ...process.env }
        jest.clearAllMocks()
    })

    afterEach(() => {
        process.env = originalEnv
        jest.clearAllMocks()
    })

    describe('Transport creation', () => {
        it('should return null for local environment', () => {
            const config: LoggerConfig = {
                env: 'local',
            }
            const transport = createCloudWatchTransport(config)
            expect(transport).toBeNull()
            expect(WinstonCloudwatch).not.toHaveBeenCalled()
        })

        it('should return null for development environment', () => {
            const config: LoggerConfig = {
                env: 'development',
            }
            const transport = createCloudWatchTransport(config)
            expect(transport).toBeNull()
            expect(WinstonCloudwatch).not.toHaveBeenCalled()
        })

        it('should create transport for staging environment', () => {
            const config: LoggerConfig = {
                env: 'staging',
                appName: 'test-app',
                logGroupName: '/aws/lambda/test-app-backend',
                awsRegion: 'us-east-1',
                retentionDays: 30,
            }
            const transport = createCloudWatchTransport(config)
            expect(transport).not.toBeNull()
            expect(WinstonCloudwatch).toHaveBeenCalled()
        })

        it('should create transport for production environment', () => {
            const config: LoggerConfig = {
                env: 'production',
                appName: 'test-app',
                logGroupName: '/aws/lambda/test-app-backend',
                awsRegion: 'us-east-1',
                retentionDays: 90,
            }
            const transport = createCloudWatchTransport(config)
            expect(transport).not.toBeNull()
            expect(WinstonCloudwatch).toHaveBeenCalled()
        })
    })

    describe('Configuration', () => {
        it('should use provided log group name', () => {
            const config: LoggerConfig = {
                env: 'staging',
                logGroupName: '/custom/log/group',
            }
            createCloudWatchTransport(config)
            expect(WinstonCloudwatch).toHaveBeenCalled()
            const callArgs = (WinstonCloudwatch as unknown as jest.Mock).mock
                .calls[0][0]
            expect(callArgs.logGroupName).toBe('/custom/log/group')
        })

        it('should use default log group name when not provided', () => {
            process.env.APP_NAME = 'test-app'
            const config: LoggerConfig = {
                env: 'staging',
            }
            createCloudWatchTransport(config)
            expect(WinstonCloudwatch).toHaveBeenCalled()
            const callArgs = (WinstonCloudwatch as unknown as jest.Mock).mock
                .calls[0][0]
            expect(callArgs.logGroupName).toBe('/aws/lambda/test-app-backend')
        })

        it('should use provided AWS region', () => {
            const config: LoggerConfig = {
                env: 'staging',
                awsRegion: 'eu-west-1',
            }
            createCloudWatchTransport(config)
            expect(WinstonCloudwatch).toHaveBeenCalled()
            const callArgs = (WinstonCloudwatch as unknown as jest.Mock).mock
                .calls[0][0]
            expect(callArgs.awsRegion).toBe('eu-west-1')
        })

        it('should use provided retention days', () => {
            const config: LoggerConfig = {
                env: 'staging',
                retentionDays: 60,
            }
            createCloudWatchTransport(config)
            expect(WinstonCloudwatch).toHaveBeenCalled()
            const callArgs = (WinstonCloudwatch as unknown as jest.Mock).mock
                .calls[0][0]
            expect(callArgs.retentionInDays).toBe(60)
        })

        it('should use environment variables when config not provided', () => {
            process.env.ENV = 'staging'
            process.env.APP_NAME = 'test-app'
            process.env.LOG_GROUP_NAME = '/aws/lambda/test-app-backend'
            process.env.AWS_REGION = 'us-east-1'
            process.env.LOG_RETENTION_DAYS = '30'

            createCloudWatchTransport({})
            expect(WinstonCloudwatch).toHaveBeenCalled()
            const callArgs = (WinstonCloudwatch as unknown as jest.Mock).mock
                .calls[0][0]
            expect(callArgs.logGroupName).toBe('/aws/lambda/test-app-backend')
            expect(callArgs.awsRegion).toBe('us-east-1')
            expect(callArgs.retentionInDays).toBe(30)
        })

        it('should configure message formatter', () => {
            const config: LoggerConfig = {
                env: 'staging',
            }
            createCloudWatchTransport(config)
            const callArgs = (WinstonCloudwatch as unknown as jest.Mock).mock
                .calls[0][0]
            expect(callArgs.messageFormatter).toBeDefined()
            expect(typeof callArgs.messageFormatter).toBe('function')

            // Test the formatter
            const formatted = callArgs.messageFormatter({
                level: 'info',
                message: 'test',
            })
            expect(formatted).toBe(
                JSON.stringify({ level: 'info', message: 'test' }),
            )
        })

        it('should configure error handler', () => {
            const config: LoggerConfig = {
                env: 'staging',
            }
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation()
            createCloudWatchTransport(config)
            const callArgs = (WinstonCloudwatch as unknown as jest.Mock).mock
                .calls[0][0]
            expect(callArgs.errorHandler).toBeDefined()
            expect(typeof callArgs.errorHandler).toBe('function')

            // Test the error handler
            const testError = new Error('Test error')
            callArgs.errorHandler(testError)
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'CloudWatch logging error:',
                testError,
            )

            consoleErrorSpy.mockRestore()
        })
    })

    describe('Error handling', () => {
        it('should handle CloudWatch errors gracefully', () => {
            const config: LoggerConfig = {
                env: 'staging',
            }
            const transport = createCloudWatchTransport(config)
            expect(transport).not.toBeNull()
            // Error handler is configured (tested above)
            expect(transport).toBeDefined()
        })
    })
})
