export interface LogContext {
    [key: string]: unknown
    service?: string
    requestId?: string
    userId?: string
    operation?: string
}

export interface LoggerConfig {
    level?: string
    logGroupName?: string
    retentionDays?: number
    awsRegion?: string
    appName?: string
    env?: string
}
