export {
    clearTraceContext,
    getCallChain,
    getCorrelationId,
    getParentRequestId,
    getRequestId,
    getTraceContext,
    getTraceContextForDownstream,
    initTraceContextFromEvent,
    setTraceContext,
} from './trace-context'
export type { IncomingTraceContext, TraceContext } from './trace-context'
