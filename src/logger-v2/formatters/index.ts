export interface FormattedLogEntry {
    timestamp: string
    level: string
    message: string
    service?: string
    requestId?: string
    [key: string]: unknown
}

/**
 * Formats log entry for development (pretty-printed, human-readable)
 */
export function formatDevLog(entry: FormattedLogEntry): string {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString()
    const level = entry.level.toUpperCase().padEnd(7)
    const service = entry.service ? `[${entry.service}]` : ''
    const requestId = entry.requestId ? `[${entry.requestId}]` : ''

    // Extract context (everything except standard fields)
    const context: Record<string, unknown> = {}
    const standardFields = [
        'timestamp',
        'level',
        'message',
        'service',
        'requestId',
    ]
    Object.keys(entry).forEach((key) => {
        if (!standardFields.includes(key)) {
            context[key] = entry[key]
        }
    })

    const contextStr =
        Object.keys(context).length > 0
            ? ` ${JSON.stringify(context, null, 2)}`
            : ''

    return `[${timestamp}] [${level}] ${service} ${requestId} ${entry.message}${contextStr}`
}

/**
 * Formats log entry for production (structured JSON for CloudWatch)
 */
export function formatProdLog(entry: FormattedLogEntry): string {
    return JSON.stringify({
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        service: entry.service,
        requestId: entry.requestId,
        ...Object.fromEntries(
            Object.entries(entry).filter(
                ([key]) =>
                    ![
                        'timestamp',
                        'level',
                        'message',
                        'service',
                        'requestId',
                    ].includes(key),
            ),
        ),
    })
}
