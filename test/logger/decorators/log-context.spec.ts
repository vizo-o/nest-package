import 'reflect-metadata'
import { LogContext } from '../../../src/logger-v2/decorators/log-context.decorator'
import type { LogContext as LogContextType } from '../../../src/logger-v2/types'

describe('LogContext decorator', () => {
    describe('Context injection', () => {
        it('should store context in metadata', () => {
            const context: LogContextType = {
                service: 'TestService',
                userId: 'user-123',
            }

            @LogContext(context)
            class TestClass {}

            const metadata = Reflect.getMetadata('logContext', TestClass)
            expect(metadata).toEqual(context)
        })

        it('should store service name in context', () => {
            const context: LogContextType = {
                service: 'UserService',
            }

            @LogContext(context)
            class UserService {}

            const metadata = Reflect.getMetadata('logContext', UserService)
            expect(metadata.service).toBe('UserService')
        })

        it('should store multiple context fields', () => {
            const context: LogContextType = {
                service: 'TestService',
                userId: 'user-123',
                operation: 'test-op',
                requestId: 'req-456',
            }

            @LogContext(context)
            class TestClass {}

            const metadata = Reflect.getMetadata('logContext', TestClass)
            expect(metadata).toEqual(context)
        })
    })

    describe('Metadata retrieval', () => {
        it('should allow retrieval of stored context', () => {
            const context: LogContextType = {
                service: 'TestService',
            }

            @LogContext(context)
            class TestClass {}

            const retrieved = Reflect.getMetadata('logContext', TestClass)
            expect(retrieved).toBeDefined()
            expect(retrieved.service).toBe('TestService')
        })

        it('should return undefined if no context is set', () => {
            class TestClass {}

            const metadata = Reflect.getMetadata('logContext', TestClass)
            expect(metadata).toBeUndefined()
        })
    })
})
