import type { LoggerService } from '../logger.service'

/**
 * Decorator to log performance metrics for methods
 * Automatically logs execution time
 */
export function LogPerformance(logger: LoggerService) {
    return function (
        target: unknown,
        propertyKey: string,
        descriptor: PropertyDescriptor,
    ) {
        const originalMethod = descriptor.value

        descriptor.value = async function (...args: unknown[]) {
            const start = Date.now()
            const methodName = `${(target as { constructor: { name: string } }).constructor.name}.${propertyKey}`

            try {
                const result = await originalMethod.apply(this, args)
                const duration = Date.now() - start

                logger.logWithContext('info', `Performance: ${methodName}`, {
                    operation: methodName,
                    duration,
                    unit: 'ms',
                })

                return result
            } catch (error) {
                const duration = Date.now() - start

                logger.logWithContext(
                    'error',
                    `Performance error: ${methodName}`,
                    {
                        operation: methodName,
                        duration,
                        unit: 'ms',
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                )

                throw error
            }
        }

        return descriptor
    }
}
