import { randomUUID } from 'crypto'

/**
 * Trace context for distributed tracing across services
 * Propagated through Lambda invocations via _traceContext field
 */
export interface TraceContext {
    /** Root trace ID for the entire call chain - shared across all related service calls */
    correlationId: string
    /** Current Lambda/request's unique ID */
    requestId: string
    /** Immediate parent's request ID (the service that called us) */
    parentRequestId?: string
    /** Full call chain showing service flow: ['api-gateway', 'operational-system', 'clinical-system'] */
    callChain: string[]
}

/**
 * Incoming trace context from Lambda event payload
 * Added by LambdaService.dispatch() when calling downstream services
 */
export interface IncomingTraceContext {
    correlationId?: string
    parentRequestId?: string
    callChain?: string[]
}

/**
 * Module-level trace context storage
 *
 * This simple approach works for Lambda because:
 * - Lambda processes one request at a time per container
 * - Each invocation sets the context at the start (overwrites any stale value)
 * - No async context propagation issues
 */
let currentTraceContext: TraceContext | undefined

/**
 * Get current trace context
 * Returns undefined if no context is set (e.g., standalone apps before initialization)
 */
export function getTraceContext(): TraceContext | undefined {
    return currentTraceContext
}

/**
 * Set trace context
 * Used by LoggerService to sync with trace context
 * Should be called at the start of each Lambda invocation
 */
export function setTraceContext(context: TraceContext): void {
    currentTraceContext = context
}

/**
 * Clear trace context
 * Can be called at the end of an invocation if needed (optional since next invocation overwrites)
 */
export function clearTraceContext(): void {
    currentTraceContext = undefined
}

/**
 * Get correlation ID for error reporting
 * Works for both NestJS apps (from trace context) and standalone apps (auto-generated)
 *
 * Priority:
 * 1. From current trace context (NestJS apps with initialized context)
 * 2. Auto-generate and store (for standalone apps)
 *
 * This ensures:
 * - Each Lambda invocation gets its own correlation ID (set at handler start)
 * - Multiple reportError calls within the same invocation share the same correlation ID
 * - ECS tasks/CLI tools get fresh context per process
 *
 * @returns Correlation ID string (never undefined)
 */
export function getCorrelationId(): string {
    if (currentTraceContext?.correlationId) {
        return currentTraceContext.correlationId
    }

    // Standalone app fallback - create minimal trace context
    const correlationId = randomUUID()
    const fallbackContext: TraceContext = {
        correlationId,
        requestId: correlationId,
        callChain: [process.env.APP_NAME || 'unknown'],
    }

    // Store so subsequent calls in the same invocation get the same ID
    currentTraceContext = fallbackContext

    return correlationId
}

/**
 * Get current request ID from trace context
 * Returns undefined if no trace context is set
 */
export function getRequestId(): string | undefined {
    return currentTraceContext?.requestId
}

/**
 * Get parent request ID from trace context
 * Returns undefined if no trace context is set or no parent exists
 */
export function getParentRequestId(): string | undefined {
    return currentTraceContext?.parentRequestId
}

/**
 * Get call chain from trace context
 * Returns undefined if no trace context is set
 */
export function getCallChain(): string[] | undefined {
    return currentTraceContext?.callChain
}

/**
 * Initialize trace context from an incoming Lambda event
 * Extracts _traceContext from event payload if present (downstream service call)
 * Otherwise creates a new root trace context (entry point)
 *
 * @param event - Incoming Lambda event (may contain _traceContext from upstream service)
 * @param currentRequestId - Current Lambda's AWS request ID
 * @param serviceName - Current service name (defaults to APP_NAME env var)
 * @returns The initialized TraceContext
 */
export function initTraceContextFromEvent(
    event: unknown,
    currentRequestId: string,
    serviceName: string = process.env.APP_NAME || 'unknown',
): TraceContext {
    // Extract incoming trace context from event payload
    const incomingContext = (event as { _traceContext?: IncomingTraceContext })
        ?._traceContext

    const context: TraceContext = {
        // Use incoming correlationId if this is a downstream call, else use current requestId as root
        correlationId: incomingContext?.correlationId || currentRequestId,
        requestId: currentRequestId,
        parentRequestId: incomingContext?.parentRequestId,
        // Append current service to call chain
        callChain: [...(incomingContext?.callChain || []), serviceName],
    }

    // Set trace context
    setTraceContext(context)

    return context
}

/**
 * Build trace context object for downstream service calls
 * Used by LambdaService.dispatch() to inject trace context into event payload
 *
 * @returns Object with _traceContext field to spread into event payload, or empty object if no context
 */
export function getTraceContextForDownstream(): {
    _traceContext?: IncomingTraceContext
} {
    if (!currentTraceContext) {
        return {}
    }

    return {
        _traceContext: {
            correlationId: currentTraceContext.correlationId,
            parentRequestId: currentTraceContext.requestId,
            callChain: currentTraceContext.callChain,
        },
    }
}
