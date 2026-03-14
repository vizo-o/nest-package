import type { LoggerService as NestLoggerService } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { AsyncLocalStorage } from 'async_hooks'
import type winston from 'winston'
import { createLogger, format } from 'winston'
import {
    getCallChain,
    getParentRequestId,
    getTraceContext,
    setTraceContext,
    type TraceContext,
} from '../trace'
import { createCloudWatchTransport } from './transports/cloudwatch.transport'
import { createDevTransport } from './transports/dev.transport'
import type { LogContext, LoggerConfig } from './types'
import { sanitizeContext } from './utils/sanitize'

interface RequestContext {
    requestId: string
    correlationId?: string
    parentRequestId?: string
    callChain?: string[]
    [key: string]: unknown
}

/**
 * LoggerService implementing NestJS LoggerService interface
 * Features:
 * - Lambda-aware request ID handling via AsyncLocalStorage
 * - Context-aware logging with auto-detected service names
 * - Sensitive data sanitization
 * - Winston-based transport system
 * - Dev and CloudWatch transports
 */
@Injectable()
export class LoggerService implements NestLoggerService {
    private readonly winstonLogger: winston.Logger
    private readonly asyncLocalStorage: AsyncLocalStorage<RequestContext>
    private serviceContext: LogContext = {}

    constructor(config?: LoggerConfig) {
        this.asyncLocalStorage = new AsyncLocalStorage<RequestContext>()

        // Build transports
        const transportList: winston.transport[] = []

        // Always add dev transport for local development
        const devTransport = createDevTransport()
        transportList.push(devTransport)

        // Add CloudWatch transport for non-local environments
        const cloudWatchTransport = createCloudWatchTransport(
            config || this.getConfigFromEnv(),
        )
        if (cloudWatchTransport) {
            transportList.push(cloudWatchTransport)
        }

        // Create Winston logger
        this.winstonLogger = createLogger({
            level: config?.level || process.env.LOG_LEVEL || 'info',
            format: format.combine(
                format.timestamp(),
                format.errors({ stack: true }),
                format.json(),
            ),
            transports: transportList,
            exitOnError: false,
            handleExceptions: true,
            handleRejections: true,
        })
    }

    /**
     * Set request ID for current Lambda invocation
     * Should be called at the start of each Lambda handler
     */
    setRequestId(requestId: string): void {
        const store = this.asyncLocalStorage.getStore()
        if (store) {
            store.requestId = requestId
        } else {
            // If no store exists, create one
            this.asyncLocalStorage.enterWith({ requestId })
        }
    }

    /**
     * Get current request ID from AsyncLocalStorage
     */
    getRequestId(): string | undefined {
        const store = this.asyncLocalStorage.getStore()

        return store?.requestId
    }

    /**
     * Set context for the logger instance
     * Context is merged with existing context
     */
    setContext(context: LogContext): void {
        this.serviceContext = { ...this.serviceContext, ...context }
    }

    /**
     * Clear context
     */
    clearContext(): void {
        this.serviceContext = {}
    }

    /**
     * Get current context
     */
    getContext(): LogContext {
        return { ...this.serviceContext }
    }

    /**
     * Set correlation context for distributed tracing
     * Syncs with global trace context module
     */
    setCorrelationContext(context: {
        correlationId: string
        parentRequestId?: string
        callChain?: string[]
    }): void {
        const store = this.asyncLocalStorage.getStore()
        if (store) {
            store.correlationId = context.correlationId
            store.parentRequestId = context.parentRequestId
            store.callChain = context.callChain
        } else {
            // If no store exists, create one with requestId if available
            const requestId = this.getRequestId() || context.correlationId
            this.asyncLocalStorage.enterWith({
                requestId,
                correlationId: context.correlationId,
                parentRequestId: context.parentRequestId,
                callChain: context.callChain,
            })
        }

        // Sync with global trace context module
        const traceContext: TraceContext = {
            correlationId: context.correlationId,
            requestId: this.getRequestId() || context.correlationId,
            parentRequestId: context.parentRequestId,
            callChain: context.callChain || [],
        }
        setTraceContext(traceContext)
    }

    /**
     * Get correlation ID from trace context
     * Checks both local AsyncLocalStorage and global trace context module
     */
    getCorrelationId(): string | undefined {
        // First check local AsyncLocalStorage
        const store = this.asyncLocalStorage.getStore()
        if (store?.correlationId) {
            return store.correlationId
        }

        // Fall back to global trace context
        const traceContext = getTraceContext()

        return traceContext?.correlationId
    }

    /**
     * Get parent request ID from trace context
     * Checks both local AsyncLocalStorage and global trace context module
     */
    getParentRequestId(): string | undefined {
        // First check local AsyncLocalStorage
        const store = this.asyncLocalStorage.getStore()
        if (store?.parentRequestId) {
            return store.parentRequestId
        }

        // Fall back to global trace context
        return getParentRequestId()
    }

    /**
     * Get call chain from trace context
     * Checks both local AsyncLocalStorage and global trace context module
     */
    getCallChain(): string[] | undefined {
        // First check local AsyncLocalStorage
        const store = this.asyncLocalStorage.getStore()
        if (store?.callChain) {
            return store.callChain
        }

        // Fall back to global trace context
        return getCallChain()
    }

    /**
     * Run a function with a specific request context
     * Used for Lambda handler initialization
     */
    runWithContext<T>(requestId: string, fn: () => T): T {
        return this.asyncLocalStorage.run({ requestId }, fn)
    }

    /**
     * Standard NestJS LoggerService interface methods
     * Supports both NestJS signature (context as string) and our enhanced API (metadata as LogContext)
     */
    log(message: string, context?: string | LogContext): void {
        if (typeof context === 'string') {
            // NestJS signature: log(message, context) where context is a string (service/module name)
            this.logMessage('info', message, context, undefined)
        } else {
            // Our API: log(message, metadata) where metadata is LogContext
            this.logMessage('info', message, undefined, context)
        }
    }

    /**
     * Error logging method supporting both NestJS and our API signatures
     * - NestJS: error(message, trace?, context?)
     * - Our API: error(message, metadata?)
     */

    error(
        message: string,
        traceOrMetadata?: string | LogContext,
        context?: string,
    ): void {
        // NestJS calls error(message, trace, context) where trace and context are strings
        // Our API calls error(message, metadata) where metadata is LogContext
        if (
            typeof traceOrMetadata === 'string' &&
            typeof context === 'string'
        ) {
            // NestJS signature: error(message, trace, context)
            this.logMessage(
                'error',
                message,
                context,
                traceOrMetadata ? { stack: traceOrMetadata } : undefined,
            )
        } else if (typeof traceOrMetadata === 'string' && !context) {
            // NestJS signature: error(message, trace)
            this.logMessage('error', message, undefined, {
                stack: traceOrMetadata,
            })
        } else if (traceOrMetadata && typeof traceOrMetadata === 'object') {
            // Our API: error(message, metadata)
            this.logMessage(
                'error',
                message,
                undefined,
                traceOrMetadata as LogContext,
            )
        } else if (typeof context === 'string') {
            // NestJS signature: error(message, undefined, context)
            this.logMessage('error', message, context, undefined)
        } else {
            // error(message) - no context
            this.logMessage('error', message, undefined, undefined)
        }
    }

    warn(message: string, context?: string | LogContext): void {
        if (typeof context === 'string') {
            // NestJS signature: warn(message, context) where context is a string
            this.logMessage('warn', message, context, undefined)
        } else {
            // Our API: warn(message, metadata) where metadata is LogContext
            this.logMessage('warn', message, undefined, context)
        }
    }

    debug(message: string, context?: string | LogContext): void {
        if (typeof context === 'string') {
            // NestJS signature: debug(message, context) where context is a string
            this.logMessage('debug', message, context, undefined)
        } else {
            // Our API: debug(message, metadata) where metadata is LogContext
            this.logMessage('debug', message, undefined, context)
        }
    }

    verbose(message: string, context?: string | LogContext): void {
        if (typeof context === 'string') {
            // NestJS signature: verbose(message, context) where context is a string
            this.logMessage('verbose', message, context, undefined)
        } else {
            // Our API: verbose(message, metadata) where metadata is LogContext
            this.logMessage('verbose', message, undefined, context)
        }
    }

    /**
     * Enhanced logging methods with context support
     */
    logWithContext(
        level: 'info' | 'warn' | 'error' | 'debug' | 'verbose',
        message: string,
        context?: LogContext,
    ): void {
        this.logMessage(level, message, undefined, context)
    }

    /**
     * Internal method to log messages
     * Auto-detects service name from call stack if not provided
     */
    private logMessage(
        level: string,
        message: string,
        serviceName?: string,
        additionalContext?: LogContext,
    ): void {
        const requestId = this.getRequestId()
        // Use provided service name, or from additionalContext, or from serviceContext, or try to detect from call stack
        let service =
            serviceName ||
            additionalContext?.service ||
            this.serviceContext.service
        if (!service) {
            // Try to detect service name from call stack (for DI usage)
            const stack = new Error().stack
            if (stack) {
                const match = stack.match(/at (\w+Service)\./)?.[1]
                if (match) {
                    service = match
                }
            }
        }
        service = service || 'App'

        // Get correlation context from trace context module
        const correlationId = this.getCorrelationId()
        const parentRequestId = this.getParentRequestId()
        const callChain = this.getCallChain()

        // Build log entry - merge contexts and ensure service is set
        const logEntry: LogContext = {
            ...this.serviceContext,
            ...additionalContext,
            service,
            requestId,
            level,
            timestamp: new Date().toISOString(),
            // Include correlation context if available
            ...(correlationId && { correlationId }),
            ...(parentRequestId && { parentRequestId }),
            ...(callChain && { callChain }),
        }

        // Sanitize sensitive data
        const sanitized = sanitizeContext(logEntry)

        // Log using Winston
        this.winstonLogger.log(level, message, sanitized)
    }

    /**
     * Get configuration from environment variables
     */
    private getConfigFromEnv(): LoggerConfig {
        return {
            level: process.env.LOG_LEVEL,
            logGroupName: process.env.LOG_GROUP_NAME,
            retentionDays: process.env.LOG_RETENTION_DAYS
                ? parseInt(process.env.LOG_RETENTION_DAYS, 10)
                : undefined,
            awsRegion: process.env.AWS_REGION,
            appName: process.env.APP_NAME || 'UnknownService',
            env: process.env.ENV || process.env.NODE_ENV,
        }
    }

    /**
     * Close the logger and clean up resources
     * Should be called when the logger is no longer needed (e.g., in tests)
     */
    close(): void {
        this.winstonLogger.close()
    }
}
