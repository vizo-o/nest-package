import type {
    ApiEvent,
    ErrorDetails,
    Permission,
    RequestPayload,
} from './entities'
import { AppError } from './entities'

// Helper functions for error formatting
export function formatErrorDetails(err: unknown): ErrorDetails {
    if (err instanceof AppError) {
        return {
            type: 'Application Error',
            message: err.message,
            statusCode: err.status,
            severity:
                err.status >= 500
                    ? 'CRITICAL'
                    : err.status >= 400
                      ? 'WARNING'
                      : 'INFO',
            cause: err.cause ? String(err.cause) : null,
            stackTrace: err.stack || null,
        }
    }

    if (err instanceof Error) {
        // Handle specific AWS/Cognito errors
        if (err.name === 'NotAuthorizedException') {
            return {
                type: 'Authentication Error',
                message: err.message,
                statusCode: 401,
                severity: 'WARNING',
                cause: err.cause ? String(err.cause) : null,
                stackTrace: err.stack || null,
            }
        }

        return {
            type: `System Error (${err.name})`,
            message: err.message,
            statusCode: 500,
            severity: 'CRITICAL',
            cause: err.cause ? String(err.cause) : null,
            stackTrace: err.stack || null,
        }
    }

    // Handle unknown error types
    return {
        type: 'Unknown Error',
        message: typeof err === 'string' ? err : JSON.stringify(err, null, 2),
        statusCode: 500,
        severity: 'CRITICAL',
        cause: null,
        stackTrace: null,
    }
}

export function formatRequestDetails(
    userEmail: string | undefined,
    requiredPermission: Permission | null,
    payload: RequestPayload | null,
    event: ApiEvent | null,
) {
    // Handle different event types - API Gateway events have headers, httpMethod, path
    // CognitoTriggerEvent has different structure. event.headers may be null (e.g. test-invoke-method).
    const isApiGatewayEvent =
        event && 'headers' in event && 'httpMethod' in event && 'path' in event
    const headers =
        isApiGatewayEvent && event?.headers !== null ? event.headers : {}

    return {
        userInfo: userEmail || 'Anonymous',
        permissionInfo: requiredPermission
            ? `${requiredPermission.action} on ${requiredPermission.resource}`
            : 'No permission required',
        endpointInfo: isApiGatewayEvent
            ? `${event.httpMethod || 'UNKNOWN'} ${event.path || 'unknown'}`
            : 'Cognito Trigger Event',
        locationInfo:
            headers && headers['CloudFront-Viewer-Country']
                ? `${headers['CloudFront-Viewer-Country']} (${headers['x-source-ip'] || 'unknown IP'})`
                : 'Unknown location',
        payloadInfo: formatPayload(payload),
    }
}

export function formatPayload(payload: RequestPayload | null): string {
    if (!payload) return 'No payload'

    try {
        // Clean up sensitive data for display
        const cleanPayload = JSON.parse(JSON.stringify(payload))

        // Truncate very long session tokens/IDs for readability
        if (
            cleanPayload.body?.sessionId &&
            cleanPayload.body.sessionId.length > 100
        ) {
            cleanPayload.body.sessionId = `${cleanPayload.body.sessionId.substring(0, 50)}...[truncated]`
        }

        // Remove or truncate other potentially long/sensitive fields
        if (cleanPayload.headers) {
            // Remove sensitive headers that should never be stored
            delete cleanPayload.headers['X-Amzn-Trace-Id']
            delete cleanPayload.headers['X-Amz-Cf-Id']

            // Redact Authorization header (JWT tokens)
            if (cleanPayload.headers['Authorization']) {
                cleanPayload.headers['Authorization'] = '[REDACTED]'
            }
            if (cleanPayload.headers['authorization']) {
                cleanPayload.headers['authorization'] = '[REDACTED]'
            }

            // Redact Cookie header
            if (cleanPayload.headers['Cookie']) {
                cleanPayload.headers['Cookie'] = '[REDACTED]'
            }
            if (cleanPayload.headers['cookie']) {
                cleanPayload.headers['cookie'] = '[REDACTED]'
            }

            // Truncate User-Agent for readability
            if (cleanPayload.headers['User-Agent']) {
                cleanPayload.headers['User-Agent'] = cleanPayload.headers[
                    'User-Agent'
                ].substring(0, 50)
            }
        }

        return JSON.stringify(cleanPayload, null, 2)
    } catch {
        return (
            String(payload).substring(0, 1000) +
            (String(payload).length > 1000 ? '...[truncated]' : '')
        )
    }
}

export function getErrorMessage(err: unknown): string {
    if (err instanceof AppError || err instanceof Error) {
        return err.message
    }

    if (typeof err === 'string') {
        return err
    }

    return 'An unknown error occurred'
}
