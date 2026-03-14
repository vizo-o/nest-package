import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { AppError } from '../api'
import { getErrorMessage } from '../api/error.helpers'
import { AdminEventTypes } from '../event/app.entities'
import {
    sanitizeContext,
    sanitizeJsonString,
} from '../logger-v2/utils/sanitize'
import {
    getCallChain,
    getCorrelationId,
    getParentRequestId,
    getTraceContext,
} from '../trace'
import { NotificationChannel } from './entities'
import { notify } from './notify-inline'

/**
 * Error context for error reporting
 */
export interface ErrorContext {
    // Basic context (auto-detected when possible)
    service?: string // Service name - auto-detected if not provided
    requestId?: string // Request ID for tracing

    // API-specific context
    endpoint?: string // API endpoint where error occurred
    userId?: string // User ID if available

    // Scheduled job context
    scheduledJob?: string // Job name if from scheduled operation

    // Correlation context (for distributed tracing)
    correlationId?: string // Root correlation ID for the entire call chain
    parentRequestId?: string // Immediate parent's request ID
    callChain?: string[] // Full call chain showing service flow

    // Custom context
    title?: string // Custom error title (useful for build failures, etc)
    description?: string // Additional description beyond error message
    severity?: 'low' | 'medium' | 'high' | 'critical'
    category?:
        | 'api_error'
        | 'scheduled_job'
        | 'infrastructure'
        | 'external_service'
        | 'custom'
    metadata?: Record<string, unknown> // Additional structured data
    fingerprint?: string // Custom fingerprint for deduplication override
}

/**
 * Get service name from environment or context
 */
function getServiceName(context?: ErrorContext): string {
    if (context?.service) {
        return context.service
    }

    return process.env.APP_NAME || 'UnknownService'
}

/**
 * Get request ID from context or generate one
 */
function getRequestId(context?: ErrorContext): string | undefined {
    return context?.requestId
}

/**
 * Determine error severity from error type and context
 */
function determineSeverity(
    error: unknown,
    context?: ErrorContext,
): 'low' | 'medium' | 'high' | 'critical' {
    // Use explicit severity if provided
    if (context?.severity) {
        return context.severity
    }

    // Determine severity based on error type
    if (error instanceof Error) {
        // Critical errors: system failures, database errors, etc.
        if (
            error.name === 'DatabaseError' ||
            error.name === 'ConnectionError' ||
            error.message.toLowerCase().includes('database') ||
            error.message.toLowerCase().includes('connection')
        ) {
            return 'critical'
        }

        // High severity: API errors, external service failures
        if (
            error.name === 'HttpException' ||
            error.message.toLowerCase().includes('api') ||
            error.message.toLowerCase().includes('http')
        ) {
            return 'high'
        }

        // Medium severity: validation errors, business logic errors
        if (
            error.name === 'ValidationError' ||
            error.message.toLowerCase().includes('validation')
        ) {
            return 'medium'
        }
    }

    // Default to high for unknown errors
    return 'high'
}

/**
 * Determine error category from error type and context
 */
function determineCategory(
    error: unknown,
    context?: ErrorContext,
):
    | 'api_error'
    | 'scheduled_job'
    | 'infrastructure'
    | 'external_service'
    | 'custom' {
    // Use explicit category if provided
    if (context?.category) {
        return context.category
    }

    // Determine category based on context first
    if (context?.scheduledJob) {
        return 'scheduled_job'
    }

    if (context?.endpoint) {
        return 'api_error'
    }

    // Determine category based on error type
    if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase()
        const errorName = error.name.toLowerCase()

        // Infrastructure errors: database, connection, system failures
        if (
            errorName === 'databaseerror' ||
            errorName === 'connectionerror' ||
            errorMessage.includes('database') ||
            errorMessage.includes('connection') ||
            errorMessage.includes('timeout') ||
            errorMessage.includes('econnrefused') ||
            errorMessage.includes('econnreset')
        ) {
            return 'infrastructure'
        }

        // External service errors: HTTP, API calls, third-party services
        if (
            errorName === 'httpexception' ||
            errorName === 'axioserror' ||
            errorMessage.includes('http') ||
            errorMessage.includes('api') ||
            errorMessage.includes('external') ||
            errorMessage.includes('service unavailable') ||
            errorMessage.includes('network')
        ) {
            return 'external_service'
        }
    }

    // Default to custom for unknown errors
    return 'custom'
}

/**
 * Extract error type from error object
 */
function getErrorType(error: unknown): string {
    if (error instanceof Error) {
        return error.name || error.constructor.name || 'Error'
    }

    return 'UnknownError'
}

/**
 * Extract key details from error
 */
function getKeyDetails(error: unknown, context?: ErrorContext): string {
    const errorMessage = getErrorMessage(error)

    if (errorMessage) {
        return errorMessage
    }

    // Fallback to description if provided
    if (context?.description) {
        return context.description
    }

    return 'Unknown error'
}

/**
 * Generate error title from error and context
 */
function generateTitle(error: unknown, context?: ErrorContext): string {
    // Use custom title if provided
    if (context?.title) {
        return context.title
    }

    const serviceName = getServiceName(context)
    const errorMessage = getErrorMessage(error)

    // Generate title based on context
    if (context?.scheduledJob) {
        return `Scheduled job error: ${context.scheduledJob}`
    }

    if (context?.endpoint) {
        return `API error: ${context.endpoint}`
    }

    // Default title
    return `Error in ${serviceName}: ${errorMessage.substring(0, 100)}`
}

/**
 * Generate error description from error and context
 */
function generateDescription(error: unknown, context?: ErrorContext): string {
    // Use custom description if provided
    if (context?.description) {
        return context.description
    }

    const errorMessage = getErrorMessage(error)
    const errorType = getErrorType(error)

    // Generate description based on context
    if (context?.scheduledJob) {
        return `Error occurred while executing scheduled job: ${context.scheduledJob}. ${errorType}: ${errorMessage}`
    }

    if (context?.endpoint) {
        return `API error occurred at ${context.endpoint}. ${errorType}: ${errorMessage}`
    }

    // Default description
    return `${errorType}: ${errorMessage}`
}

/**
 * Format error for fallback notification
 */
function formatFallbackErrorMessage(
    error: unknown,
    context?: ErrorContext,
    adminServiceError?: unknown,
): string {
    const serviceName = getServiceName(context)
    const errorMessage = getErrorMessage(error)
    const timestamp = new Date().toISOString()
    const requestId = getRequestId(context)

    const message = [
        '🚨 FALLBACK ERROR NOTIFICATION',
        '=================',
        '',
        '⚠️ Admin service unavailable - using direct notification',
        `🌐 SERVICE: ${serviceName.toUpperCase()}`,
        `⏰ TIMESTAMP: ${timestamp}`,
        '',
    ]

    if (requestId) {
        message.push(`🔍 REQUEST ID: ${requestId}`)
    }

    if (context?.endpoint) {
        message.push(`🛣️  ENDPOINT: ${context.endpoint}`)
    }

    if (context?.scheduledJob) {
        message.push(`⏰ SCHEDULED JOB: ${context.scheduledJob}`)
    }

    if (context?.userId) {
        message.push(`👤 USER ID: ${context.userId}`)
    }

    message.push('', `❌ ERROR: ${errorMessage}`, '')

    if (error instanceof Error && error.stack) {
        message.push('📍 STACK TRACE:', error.stack, '')
    }

    if (adminServiceError) {
        const adminErrorMsg =
            adminServiceError instanceof Error
                ? adminServiceError.message
                : String(adminServiceError)
        message.push('', '⚠️ ADMIN SERVICE ERROR:', adminErrorMsg, '')
    }

    if (context?.metadata) {
        message.push(
            '',
            '📦 METADATA:',
            JSON.stringify(context.metadata, null, 2),
            '',
        )
    }

    message.push('=================')

    return message.join('\n')
}

/**
 * Report error to admin service via Incident Processing Queue
 * Falls back to direct email notification if admin service unavailable
 *
 * @param error - The error to report
 * @param context - Optional error context for enrichment
 */
export async function reportError(
    error: unknown,
    context?: ErrorContext,
): Promise<void> {
    const serviceName = getServiceName(context)
    const requestId = getRequestId(context)
    const errorType = getErrorType(error)
    const severity = determineSeverity(error, context)
    const category = determineCategory(error, context)
    const title = generateTitle(error, context)
    const description = generateDescription(error, context)
    const keyDetails = getKeyDetails(error, context)

    // Get correlation context from trace module (auto-generated if not available)
    // Priority: 1. From context parameter, 2. From trace context module, 3. Auto-generate
    let correlationId = context?.correlationId
    let parentRequestId = context?.parentRequestId
    let callChain = context?.callChain

    // Always check trace module for missing fields, even if correlationId is provided
    const traceContext = getTraceContext()
    if (traceContext) {
        // Use trace module values for fields not provided in context
        correlationId = correlationId || traceContext.correlationId
        parentRequestId = parentRequestId || getParentRequestId()
        callChain = callChain || getCallChain()
    } else if (!correlationId) {
        // No trace context and no correlationId in context - auto-generate
        // This ensures standalone apps get correlation IDs automatically
        correlationId = getCorrelationId()
        // For standalone apps, try to get parentRequestId and callChain from trace module
        // (they may be set by getCorrelationId() if it creates a fallback context)
        parentRequestId = parentRequestId || getParentRequestId()
        callChain = callChain || getCallChain()
    }

    // Build error report payload
    const errorReport: {
        type: AdminEventTypes
        service: string
        errorType?: string
        endpoint?: string
        scheduledJob?: string
        title: string
        description?: string
        severity: 'low' | 'medium' | 'high' | 'critical'
        metadata?: Record<string, unknown>
        keyDetails: string
        correlationId?: string
        parentRequestId?: string
        callChain?: string[]
        fingerprint?: string
    } = {
        type: AdminEventTypes.INCIDENT_PROCESSING_QUEUE,
        service: serviceName,
        title,
        severity,
        keyDetails,
    }

    // Add correlation context fields
    if (correlationId) {
        errorReport.correlationId = correlationId
    }
    if (parentRequestId) {
        errorReport.parentRequestId = parentRequestId
    }
    if (callChain && callChain.length > 0) {
        errorReport.callChain = callChain
    }

    // Add optional fields
    if (errorType && errorType !== 'Error') {
        errorReport.errorType = errorType
    }

    if (context?.endpoint) {
        errorReport.endpoint = context.endpoint
    }

    if (context?.scheduledJob) {
        errorReport.scheduledJob = context.scheduledJob
    }

    if (context?.fingerprint) {
        errorReport.fingerprint = context.fingerprint
    }

    errorReport.description = description

    // Extract user context for sanitization
    // Try to get userEmail and userRoles from metadata or context
    let userEmail: string | undefined = context?.userId
    let userRoles: string[] | undefined

    // Check if metadata contains userRoles (from API service)
    if (context?.metadata) {
        if (Array.isArray(context.metadata.userRoles)) {
            userRoles = context.metadata.userRoles as string[]
        }
        // Also check for userEmail in metadata (might be different from userId)
        if (
            typeof context.metadata.userInfo === 'string' &&
            context.metadata.userInfo !== 'Anonymous'
        ) {
            userEmail = context.metadata.userInfo
        }
    }

    // Build metadata object
    const metadata: Record<string, unknown> = {
        ...(context?.metadata || {}),
    }

    if (requestId) {
        metadata.requestId = requestId
    }

    if (context?.userId) {
        metadata.userId = context.userId
    }

    // Always include category (auto-generated if not provided)
    metadata.category = category

    // Add error details to metadata
    if (error instanceof Error) {
        metadata.errorName = error.name
        if (error.stack) {
            metadata.stackTrace = error.stack
        }
        if (error.cause) {
            metadata.cause = String(error.cause)
        }
    }

    // Sanitize metadata before adding to errorReport
    // Handle payloadInfo JSON string specially
    if (metadata.payloadInfo && typeof metadata.payloadInfo === 'string') {
        // payloadInfo is a JSON string - sanitize it recursively
        metadata.payloadInfo = sanitizeJsonString(
            metadata.payloadInfo,
            userEmail,
            userRoles,
        )
    }

    // Apply sanitization to the entire metadata object
    const sanitizedMetadata = sanitizeContext(metadata, userEmail, userRoles)

    if (Object.keys(sanitizedMetadata).length > 0) {
        errorReport.metadata = sanitizedMetadata
    }

    if (
        error instanceof AppError &&
        (error as AppError).notifyAdmin === false
    ) {
        return // Don't send to admin system
    }

    // Try to send to admin service via SQS
    const incidentProcessingQueueUrl = process.env.INCIDENT_PROCESSING_QUEUE_URL
    const isLocalDev =
        process.env.ENV === 'local' || !process.env.ENV || !process.env.NODE_ENV

    if (incidentProcessingQueueUrl) {
        try {
            // Configure SQS client for LocalStack in local dev
            let sqsClient: SQSClient

            if (isLocalDev && process.env.AWS_ENDPOINT_URL_SQS) {
                // Use LocalStack endpoint for local development
                sqsClient = new SQSClient({
                    endpoint: process.env.AWS_ENDPOINT_URL_SQS,
                    region: process.env.AWS_REGION || 'us-east-1',
                    credentials: {
                        accessKeyId: 'test',
                        secretAccessKey: 'test',
                    },
                })
            } else {
                sqsClient = new SQSClient({})
            }
            await sqsClient.send(
                new SendMessageCommand({
                    QueueUrl: incidentProcessingQueueUrl,
                    MessageBody: JSON.stringify(errorReport),
                }),
            )

            // Successfully sent to admin service
            if (isLocalDev) {
                console.log(
                    '[LOCAL DEV] Successfully sent error report to LocalStack SQS:',
                    JSON.stringify(errorReport, null, 2),
                )
            }

            return
        } catch (adminServiceError) {
            // Log the error but continue to fallback
            console.error(
                'Failed to send error report to admin service:',
                adminServiceError,
            )

            // Fall through to fallback notification
        }
    }

    // Fallback: Direct email notification via existing notify()
    try {
        const fallbackSubject = `[FALLBACK] ${title}`
        const fallbackMessage = formatFallbackErrorMessage(
            error,
            context,
            incidentProcessingQueueUrl
                ? undefined
                : new Error('INCIDENT_PROCESSING_QUEUE_URL not configured'),
        )

        await notify({
            notificationChannels: [NotificationChannel.ADMIN],
            subject: fallbackSubject,
            message: fallbackMessage,
        })
    } catch (fallbackError) {
        // Last resort: log to console
        console.error('Failed to send fallback notification:', fallbackError)
        console.error('Original error:', error)
        console.error('Error context:', context)
    }
}
