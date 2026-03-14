import chalk from 'chalk'
import winston from 'winston'
import type { LogContext } from '../types'

const levelEmojis: Record<string, string> = {
    error: '🚨',
    warn: '🔔',
    info: '📡',
    http: '🌐',
    verbose: '🔍',
    debug: '🐛',
}

const levelColors: Record<string, string> = {
    error: 'red',
    warn: 'yellow',
    info: 'blue',
    http: 'magenta',
    verbose: 'cyan',
    debug: 'green',
}

const createTimestamp = (): string => {
    return chalk.gray(`[${new Date().toLocaleTimeString()}]`)
}

/**
 * Dev transport for local development
 * Pretty-printed, color-coded console output
 */
export function createDevTransport(): winston.transport {
    const logLevel = process.env.LOG_LEVEL || 'debug'

    return new winston.transports.Console({
        level: logLevel,
        format: winston.format.printf((info) => {
            const { level, message, service, requestId, ...rest } = info

            const emoji = levelEmojis[level] || '📋'
            const colorName = levelColors[level] || 'white'
            const colorizedLevel = (
                chalk[colorName as keyof typeof chalk] as (
                    text: string,
                ) => string
            )(level.toUpperCase().padEnd(7))
            const header = `${createTimestamp()} ${emoji}  ${colorizedLevel}`
            const serviceContext = service ? chalk.blue(`[${service}]`) : ''
            const requestContext = requestId ? chalk.gray(`[${requestId}]`) : ''

            let formattedMessage: string
            if (level === 'error') {
                formattedMessage = chalk.red.bold(String(message))
            } else if (level === 'warn') {
                formattedMessage = chalk.yellow.bold(String(message))
            } else {
                formattedMessage = chalk.white(String(message))
            }

            // Format additional context (exclude timestamp, requestId, and other Winston metadata)
            const excludedKeys = [
                'timestamp',
                'requestId',
                'level',
                'message',
                'service',
            ]
            const restKeys = Object.keys(rest).filter(
                (key) => rest[key] !== undefined && !excludedKeys.includes(key),
            )
            let additionalData = ''
            if (restKeys.length > 0) {
                const contextObj: LogContext = {}
                restKeys.forEach((key) => {
                    contextObj[key] = rest[key]
                })
                additionalData = `\n${chalk.gray(JSON.stringify(contextObj, null, 2))}`
            }

            return `${header} ${serviceContext} ${requestContext} ${formattedMessage}${additionalData}`
        }),
    })
}
