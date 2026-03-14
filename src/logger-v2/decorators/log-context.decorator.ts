import type { LogContext as LogContextType } from '../types'

/**
 * Decorator to inject logging context
 * Can be used to add context to a class or method
 */
export function LogContext(context: LogContextType) {
    return function (target: unknown) {
        // Store context in metadata for later retrieval
        Reflect.defineMetadata('logContext', context, target as object)
    }
}
