import { CloudWatchLogs } from '@aws-sdk/client-cloudwatch-logs'
import type winston from 'winston'
import WinstonCloudwatch from 'winston-cloudwatch'
import type { LoggerConfig } from '../types'

const getLogStream = (): string => {
    const date = new Date()

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * CloudWatch transport for production/staging environments
 * Only created for non-local environments
 */
export function createCloudWatchTransport(
    config: LoggerConfig,
): winston.transport | null {
    const env = config.env || process.env.ENV || process.env.NODE_ENV
    const isLocal = env === 'local' || env === 'development'

    // Don't create CloudWatch transport for local development
    if (isLocal) {
        return null
    }

    const appName = config.appName || process.env.APP_NAME || 'NestJS'
    const logGroupName =
        config.logGroupName ||
        process.env.LOG_GROUP_NAME ||
        `/aws/lambda/${appName}-backend`
    const awsRegion = config.awsRegion || process.env.AWS_REGION || 'us-east-1'
    const retentionDays =
        config.retentionDays ||
        parseInt(process.env.LOG_RETENTION_DAYS || '30', 10)

    return new WinstonCloudwatch({
        name: 'CloudWatch',
        logGroupName,
        logStreamName: getLogStream(),
        awsRegion,
        cloudWatchLogs: new CloudWatchLogs({
            region: awsRegion,
        }),
        ensureLogGroup: true,
        messageFormatter: (logObject: Record<string, unknown>) => {
            return JSON.stringify(logObject)
        },
        uploadRate: 2000,
        retentionInDays: retentionDays,
        errorHandler: (err: Error) => {
            // Use console.error as fallback if CloudWatch logging fails
            console.error('CloudWatch logging error:', err)
        },
    })
}
