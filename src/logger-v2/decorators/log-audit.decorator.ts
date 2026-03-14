import type { LoggerService } from '../logger.service'
import type { LogContext } from '../types'

/**
 * Decorator to log audit events for security-sensitive operations
 * Logs user actions, config changes, etc.
 */
export function LogAudit(
    logger: LoggerService,
    auditType: string,
    additionalContext?: LogContext,
) {
    return function (
        target: unknown,
        propertyKey: string,
        descriptor: PropertyDescriptor,
    ) {
        const originalMethod = descriptor.value

        descriptor.value = async function (...args: unknown[]) {
            const methodName = `${(target as { constructor: { name: string } }).constructor.name}.${propertyKey}`

            try {
                const result = await originalMethod.apply(this, args)

                logger.logWithContext('info', `Audit: ${auditType}`, {
                    auditType,
                    operation: methodName,
                    ...additionalContext,
                })

                return result
            } catch (error) {
                logger.logWithContext('error', `Audit error: ${auditType}`, {
                    auditType,
                    operation: methodName,
                    error:
                        error instanceof Error ? error.message : String(error),
                    ...additionalContext,
                })

                throw error
            }
        }

        return descriptor
    }
}
