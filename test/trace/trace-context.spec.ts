import {
    clearTraceContext,
    getCallChain,
    getCorrelationId,
    getParentRequestId,
    getRequestId,
    getTraceContext,
    getTraceContextForDownstream,
    initTraceContextFromEvent,
    setTraceContext,
} from '../../src/trace/trace-context'
import type { TraceContext } from '../../src/trace/trace-context'

describe('TraceContext', () => {
    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
        originalEnv = { ...process.env }
        // Clear trace context before each test to ensure isolation
        clearTraceContext()
    })

    afterEach(() => {
        process.env = originalEnv
        // Clear trace context after each test
        clearTraceContext()
    })

    describe('getTraceContext', () => {
        it('should return undefined when no context is set', () => {
            expect(getTraceContext()).toBeUndefined()
        })

        it('should return context after setTraceContext is called', () => {
            const context: TraceContext = {
                correlationId: 'corr-123',
                requestId: 'req-456',
                callChain: ['service-a'],
            }

            setTraceContext(context)

            expect(getTraceContext()).toEqual(context)
        })
    })

    describe('setTraceContext', () => {
        it('should set trace context that can be retrieved', () => {
            const context: TraceContext = {
                correlationId: 'corr-abc',
                requestId: 'req-def',
                parentRequestId: 'parent-xyz',
                callChain: ['service-a', 'service-b'],
            }

            setTraceContext(context)

            const retrieved = getTraceContext()
            expect(retrieved?.correlationId).toBe('corr-abc')
            expect(retrieved?.requestId).toBe('req-def')
            expect(retrieved?.parentRequestId).toBe('parent-xyz')
            expect(retrieved?.callChain).toEqual(['service-a', 'service-b'])
        })

        it('should overwrite previous context (simulating new Lambda invocation)', () => {
            // First invocation
            setTraceContext({
                correlationId: 'first-corr',
                requestId: 'first-req',
                callChain: ['first-service'],
            })

            expect(getTraceContext()?.correlationId).toBe('first-corr')

            // Second invocation (warm start) - overwrites
            setTraceContext({
                correlationId: 'second-corr',
                requestId: 'second-req',
                callChain: ['second-service'],
            })

            expect(getTraceContext()?.correlationId).toBe('second-corr')
            expect(getTraceContext()?.requestId).toBe('second-req')
        })
    })

    describe('clearTraceContext', () => {
        it('should clear the trace context', () => {
            setTraceContext({
                correlationId: 'corr-123',
                requestId: 'req-456',
                callChain: ['service'],
            })

            expect(getTraceContext()).toBeDefined()

            clearTraceContext()

            expect(getTraceContext()).toBeUndefined()
        })
    })

    describe('getCorrelationId', () => {
        it('should return correlationId from trace context when set', () => {
            const context: TraceContext = {
                correlationId: 'corr-from-context',
                requestId: 'req-123',
                callChain: [],
            }

            setTraceContext(context)

            expect(getCorrelationId()).toBe('corr-from-context')
        })

        it('should generate standalone correlationId when no context exists', () => {
            // No context set - should generate UUID
            const correlationId = getCorrelationId()

            expect(correlationId).toBeDefined()
            expect(typeof correlationId).toBe('string')
            expect(correlationId.length).toBeGreaterThan(0)
            // UUID format check
            expect(correlationId).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            )
        })

        it('should return same standalone correlationId across multiple calls', () => {
            // No context set - should generate UUID and store
            // All calls should return same ID
            const firstCall = getCorrelationId()
            const secondCall = getCorrelationId()
            const thirdCall = getCorrelationId()

            expect(firstCall).toBe(secondCall)
            expect(secondCall).toBe(thirdCall)
        })

        it('should create context for standalone apps', () => {
            // Simulate standalone Lambda invocation
            const correlationId1 = getCorrelationId()
            const correlationId2 = getCorrelationId()

            // Should be same within same invocation
            expect(correlationId1).toBe(correlationId2)

            // Verify context was created
            const context = getTraceContext()
            expect(context).toBeDefined()
            expect(context?.correlationId).toBe(correlationId1)
            expect(context?.requestId).toBe(correlationId1)
            expect(context?.callChain).toEqual([
                process.env.APP_NAME || 'unknown',
            ])
        })
    })

    describe('getRequestId', () => {
        it('should return undefined when no context is set', () => {
            expect(getRequestId()).toBeUndefined()
        })

        it('should return requestId from trace context', () => {
            setTraceContext({
                correlationId: 'corr-123',
                requestId: 'my-request-id',
                callChain: [],
            })

            expect(getRequestId()).toBe('my-request-id')
        })
    })

    describe('getParentRequestId', () => {
        it('should return undefined when no context is set', () => {
            expect(getParentRequestId()).toBeUndefined()
        })

        it('should return undefined when context has no parent', () => {
            setTraceContext({
                correlationId: 'corr-123',
                requestId: 'req-456',
                callChain: [],
            })

            expect(getParentRequestId()).toBeUndefined()
        })

        it('should return parentRequestId from trace context', () => {
            setTraceContext({
                correlationId: 'corr-123',
                requestId: 'req-456',
                parentRequestId: 'parent-789',
                callChain: [],
            })

            expect(getParentRequestId()).toBe('parent-789')
        })
    })

    describe('getCallChain', () => {
        it('should return undefined when no context is set', () => {
            expect(getCallChain()).toBeUndefined()
        })

        it('should return callChain from trace context', () => {
            setTraceContext({
                correlationId: 'corr-123',
                requestId: 'req-456',
                callChain: [
                    'api-gateway',
                    'operational-system',
                    'clinical-system',
                ],
            })

            expect(getCallChain()).toEqual([
                'api-gateway',
                'operational-system',
                'clinical-system',
            ])
        })
    })

    describe('initTraceContextFromEvent', () => {
        it('should create root context when no _traceContext in event', () => {
            const event = { type: 'SOME_EVENT', data: {} }
            const requestId = 'aws-request-123'

            process.env.APP_NAME = 'test-service'

            const context = initTraceContextFromEvent(event, requestId)

            expect(context.correlationId).toBe(requestId)
            expect(context.requestId).toBe(requestId)
            expect(context.parentRequestId).toBeUndefined()
            expect(context.callChain).toEqual(['test-service'])
        })

        it('should use custom service name when provided', () => {
            const event = { type: 'SOME_EVENT' }
            const requestId = 'req-custom'

            const context = initTraceContextFromEvent(
                event,
                requestId,
                'my-custom-service',
            )

            expect(context.callChain).toEqual(['my-custom-service'])
        })

        it('should use "unknown" as default service name when APP_NAME not set', () => {
            delete process.env.APP_NAME
            const event = { type: 'SOME_EVENT' }
            const requestId = 'req-unknown'

            const context = initTraceContextFromEvent(event, requestId)

            expect(context.callChain).toEqual(['unknown'])
        })

        it('should extract trace context from downstream call', () => {
            const event = {
                type: 'SOME_EVENT',
                _traceContext: {
                    correlationId: 'original-corr-id',
                    parentRequestId: 'upstream-request-id',
                    callChain: ['api-gateway', 'operational-system'],
                },
            }
            const requestId = 'current-request-id'

            const context = initTraceContextFromEvent(
                event,
                requestId,
                'clinical-system',
            )

            expect(context.correlationId).toBe('original-corr-id')
            expect(context.requestId).toBe(requestId)
            expect(context.parentRequestId).toBe('upstream-request-id')
            expect(context.callChain).toEqual([
                'api-gateway',
                'operational-system',
                'clinical-system',
            ])
        })

        it('should set trace context that can be retrieved', () => {
            const event = { type: 'TEST' }
            const requestId = 'req-storage-test'

            initTraceContextFromEvent(event, requestId, 'storage-test-service')

            const stored = getTraceContext()
            expect(stored?.requestId).toBe(requestId)
            expect(stored?.callChain).toEqual(['storage-test-service'])
        })

        it('should handle partial _traceContext gracefully', () => {
            const event = {
                type: 'SOME_EVENT',
                _traceContext: {
                    correlationId: 'partial-corr-id',
                    // No parentRequestId or callChain
                },
            }
            const requestId = 'current-req'

            const context = initTraceContextFromEvent(
                event,
                requestId,
                'test-svc',
            )

            expect(context.correlationId).toBe('partial-corr-id')
            expect(context.parentRequestId).toBeUndefined()
            expect(context.callChain).toEqual(['test-svc'])
        })
    })

    describe('getTraceContextForDownstream', () => {
        it('should return empty object when no context is set', () => {
            const result = getTraceContextForDownstream()

            expect(result).toEqual({})
        })

        it('should return _traceContext with current context for downstream calls', () => {
            setTraceContext({
                correlationId: 'corr-for-downstream',
                requestId: 'current-req-id',
                parentRequestId: 'parent-req',
                callChain: ['service-a', 'service-b'],
            })

            const result = getTraceContextForDownstream()

            expect(result._traceContext).toBeDefined()
            expect(result._traceContext?.correlationId).toBe(
                'corr-for-downstream',
            )
            expect(result._traceContext?.parentRequestId).toBe('current-req-id')
            expect(result._traceContext?.callChain).toEqual([
                'service-a',
                'service-b',
            ])
        })

        it('should be spreadable into event payload', () => {
            setTraceContext({
                correlationId: 'spread-corr-id',
                requestId: 'spread-req-id',
                callChain: ['test-service'],
            })

            const eventPayload = {
                type: 'SOME_EVENT',
                data: { foo: 'bar' },
                ...getTraceContextForDownstream(),
            }

            expect(eventPayload.type).toBe('SOME_EVENT')
            expect(eventPayload.data).toEqual({ foo: 'bar' })
            expect(eventPayload._traceContext).toBeDefined()
            expect(eventPayload._traceContext?.correlationId).toBe(
                'spread-corr-id',
            )
        })
    })

    describe('Integration scenarios', () => {
        it('should support full request flow: entry -> downstream -> error reporting', () => {
            // Step 1: Entry point initializes context
            const entryEvent = { type: 'API_REQUEST' }
            const entryRequestId = 'entry-req-001'
            initTraceContextFromEvent(entryEvent, entryRequestId, 'api-gateway')

            // Step 2: Get context for downstream call
            const downstreamPayload = getTraceContextForDownstream()

            // Step 3: Simulate downstream service receiving the call
            const downstreamEvent = {
                type: 'INTERNAL_EVENT',
                ...downstreamPayload,
            }
            const downstreamRequestId = 'downstream-req-002'
            const downstreamContext = initTraceContextFromEvent(
                downstreamEvent,
                downstreamRequestId,
                'downstream-service',
            )

            // Verify the chain is maintained
            expect(downstreamContext.correlationId).toBe(entryRequestId)
            expect(downstreamContext.parentRequestId).toBe(entryRequestId)
            expect(downstreamContext.requestId).toBe(downstreamRequestId)
            expect(downstreamContext.callChain).toEqual([
                'api-gateway',
                'downstream-service',
            ])

            // Step 4: Error occurs - correlation ID is available for reporting
            const correlationId = getCorrelationId()
            expect(correlationId).toBe(entryRequestId)
        })

        it('should handle standalone app scenario', () => {
            // No trace context initialized (standalone app like backup-validation)
            // getCorrelationId will auto-create context

            // First error report
            const firstCorrelationId = getCorrelationId()

            // Second error report in same invocation/process
            const secondCorrelationId = getCorrelationId()

            // Third error report
            const thirdCorrelationId = getCorrelationId()

            // All should share the same correlation ID within same invocation
            expect(firstCorrelationId).toBe(secondCorrelationId)
            expect(secondCorrelationId).toBe(thirdCorrelationId)

            // Should be a valid UUID
            expect(firstCorrelationId).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            )

            // Verify context was created
            const context = getTraceContext()
            expect(context).toBeDefined()
            expect(context?.correlationId).toBe(firstCorrelationId)
        })

        it('should handle warm Lambda scenario (context overwrite)', () => {
            // First invocation
            initTraceContextFromEvent(
                { type: 'FIRST_EVENT' },
                'first-request-id',
                'my-service',
            )
            expect(getCorrelationId()).toBe('first-request-id')

            // Second invocation (warm start) - context should be overwritten
            initTraceContextFromEvent(
                { type: 'SECOND_EVENT' },
                'second-request-id',
                'my-service',
            )
            expect(getCorrelationId()).toBe('second-request-id')

            // Verify old context is completely gone
            const context = getTraceContext()
            expect(context?.requestId).toBe('second-request-id')
            expect(context?.callChain).toEqual(['my-service'])
        })
    })
})
