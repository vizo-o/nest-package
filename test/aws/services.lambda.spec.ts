// Set environment variables BEFORE any imports that might use them
process.env.APP_NAME = 'test-app'
process.env.ENV = 'test'

import { LambdaService } from '../../src/aws/services'
import { Service } from '../../src/event/app.entities'
import { LoggerService } from '../../src/logger-v2/logger.service'
import { clearTraceContext } from '../../src/trace'

// Mock AWS SDK Lambda Client
const mockSend = jest.fn()
jest.mock('@aws-sdk/client-lambda', () => {
    return {
        LambdaClient: jest.fn().mockImplementation(() => ({
            send: mockSend,
        })),
        InvokeCommand: jest.fn().mockImplementation((params) => ({
            input: params,
        })),
        InvocationType: {
            Event: 'Event',
            RequestResponse: 'RequestResponse',
        },
    }
})

describe('LambdaService Trace Context Injection', () => {
    let lambdaService: LambdaService
    let loggerService: LoggerService

    beforeEach(() => {
        jest.clearAllMocks()
        clearTraceContext() // Clear any trace context from previous tests
        loggerService = new LoggerService()
        lambdaService = new LambdaService(loggerService)
    })

    afterEach(() => {
        jest.clearAllMocks()
        if (loggerService) {
            try {
                loggerService.close()
            } catch {
                // Ignore cleanup errors
            }
        }
    })

    describe('dispatch', () => {
        it('should inject trace context when available', async () => {
            // Set up trace context
            loggerService.setRequestId('req-123')
            loggerService.setCorrelationContext({
                correlationId: 'corr-abc',
                parentRequestId: 'parent-xyz',
                callChain: ['service-a', 'service-b'],
            })

            // Mock successful Lambda invocation
            mockSend.mockResolvedValue({
                StatusCode: 200,
                Payload: Buffer.from(
                    JSON.stringify({
                        body: JSON.stringify([
                            {
                                status: 200,
                                message: 'Success',
                                data: JSON.stringify({ result: 'ok' }),
                            },
                        ]),
                    }),
                ),
            })

            const event = { type: 'TEST_EVENT', data: { foo: 'bar' } }
            await lambdaService.dispatch(Service.OPERATIONAL, event)

            // Verify Lambda was invoked
            expect(mockSend).toHaveBeenCalledTimes(1)
            const invokeCommand = mockSend.mock.calls[0][0]

            // Parse the payload to verify trace context was injected
            const payload = JSON.parse(invokeCommand.input.Payload.toString())
            expect(payload._traceContext).toBeDefined()
            expect(payload._traceContext.correlationId).toBe('corr-abc')
            expect(payload._traceContext.parentRequestId).toBe('req-123')
            expect(payload._traceContext.callChain).toEqual([
                'service-a',
                'service-b',
            ])

            // Verify original event data is preserved
            expect(payload.type).toBe('TEST_EVENT')
            expect(payload.data).toEqual({ foo: 'bar' })
        })

        it('should not inject trace context when not available', async () => {
            // No trace context set

            // Mock successful Lambda invocation
            mockSend.mockResolvedValue({
                StatusCode: 200,
                Payload: Buffer.from(
                    JSON.stringify({
                        body: JSON.stringify([
                            {
                                status: 200,
                                message: 'Success',
                                data: JSON.stringify({ result: 'ok' }),
                            },
                        ]),
                    }),
                ),
            })

            const event = { type: 'TEST_EVENT', data: { foo: 'bar' } }
            await lambdaService.dispatch(Service.OPERATIONAL, event)

            // Verify Lambda was invoked
            expect(mockSend).toHaveBeenCalledTimes(1)
            const invokeCommand = mockSend.mock.calls[0][0]

            // Parse the payload - should not have _traceContext
            const payload = JSON.parse(invokeCommand.input.Payload.toString())
            expect(payload._traceContext).toBeUndefined()

            // Verify original event data is preserved
            expect(payload.type).toBe('TEST_EVENT')
            expect(payload.data).toEqual({ foo: 'bar' })
        })
    })

    describe('dispatchAsync', () => {
        it('should inject trace context in async dispatch', async () => {
            // Set up trace context
            loggerService.setRequestId('req-async')
            loggerService.setCorrelationContext({
                correlationId: 'corr-async',
                callChain: ['async-service'],
            })

            // Mock async Lambda invocation
            mockSend.mockResolvedValue({
                StatusCode: 202,
            })

            const event = { type: 'ASYNC_EVENT', data: { async: true } }
            const result = await lambdaService.dispatchAsync(
                Service.CLINICAL,
                event,
            )

            // Verify async response
            expect(result.status).toBe(202)
            expect(result.message).toBe('Event dispatched')

            // Verify Lambda was invoked
            expect(mockSend).toHaveBeenCalledTimes(1)
            const invokeCommand = mockSend.mock.calls[0][0]

            // Verify async invocation type
            expect(invokeCommand.input.InvocationType).toBe('Event')

            // Parse the payload to verify trace context was injected
            const payload = JSON.parse(invokeCommand.input.Payload.toString())
            expect(payload._traceContext).toBeDefined()
            expect(payload._traceContext.correlationId).toBe('corr-async')
            expect(payload._traceContext.parentRequestId).toBe('req-async')
        })
    })

    describe('trace context propagation', () => {
        it('should propagate full call chain', async () => {
            loggerService.setRequestId('req-chain')
            loggerService.setCorrelationContext({
                correlationId: 'corr-chain',
                callChain: ['api-gateway', 'operational-system'],
            })

            mockSend.mockResolvedValue({
                StatusCode: 200,
                Payload: Buffer.from(
                    JSON.stringify({
                        body: JSON.stringify([
                            {
                                status: 200,
                                message: 'Success',
                                data: JSON.stringify({}),
                            },
                        ]),
                    }),
                ),
            })

            await lambdaService.dispatch(Service.CLINICAL, {
                type: 'CHAIN_TEST',
            })

            const invokeCommand = mockSend.mock.calls[0][0]
            const payload = JSON.parse(invokeCommand.input.Payload.toString())

            expect(payload._traceContext.callChain).toEqual([
                'api-gateway',
                'operational-system',
            ])
        })

        it('should use current requestId as parentRequestId', async () => {
            loggerService.setRequestId('current-request-id')
            loggerService.setCorrelationContext({
                correlationId: 'corr-parent',
                callChain: [],
            })

            mockSend.mockResolvedValue({
                StatusCode: 200,
                Payload: Buffer.from(
                    JSON.stringify({
                        body: JSON.stringify([
                            {
                                status: 200,
                                message: 'Success',
                                data: JSON.stringify({}),
                            },
                        ]),
                    }),
                ),
            })

            await lambdaService.dispatch(Service.OPERATIONAL, {
                type: 'PARENT_TEST',
            })

            const invokeCommand = mockSend.mock.calls[0][0]
            const payload = JSON.parse(invokeCommand.input.Payload.toString())

            // parentRequestId should be the current requestId
            expect(payload._traceContext.parentRequestId).toBe(
                'current-request-id',
            )
        })
    })

    describe('invokeFunction', () => {
        it('should invoke a lambda by name and return parsed payload', async () => {
            mockSend.mockResolvedValue({
                StatusCode: 200,
                Payload: Buffer.from(
                    JSON.stringify({
                        s3Key: 'shipping-invoices/test.pdf',
                        bucket: 'operational-bucket',
                    }),
                ),
            })

            const result = await lambdaService.invokeFunction<{
                s3Key: string
                bucket: string
            }>({
                functionName: 'shipping-invoice-generator',
                payload: { purchaseId: 'purchase-123' },
            })

            expect(result).toEqual({
                s3Key: 'shipping-invoices/test.pdf',
                bucket: 'operational-bucket',
            })
            expect(mockSend).toHaveBeenCalledTimes(1)
            const invokeCommand = mockSend.mock.calls[0][0]
            expect(invokeCommand.input.FunctionName).toBe(
                'shipping-invoice-generator',
            )
            expect(invokeCommand.input.InvocationType).toBe('RequestResponse')
        })
    })
})
