/**
 * Serializes thrown values for structured logs.
 * Error (and subclasses such as Prisma's) use non-enumerable properties, so
 * `{ ...err }` and JSON.stringify lose message/stack — this preserves them.
 */

const MAX_CAUSE_DEPTH = 5

export type SerializedErrorForLog = {
    name: string
    message: string
    stack?: string
    /** Prisma Client known / validation errors */
    code?: string
    meta?: unknown
    clientVersion?: string
    /** AggregateError */
    errors?: SerializedErrorForLog[]
    cause?: SerializedErrorForLog
}

function serializeUnknown(value: unknown, depth: number): SerializedErrorForLog {
    if (depth > MAX_CAUSE_DEPTH) {
        return {
            name: 'TruncatedError',
            message: 'Error cause chain exceeded max depth',
        }
    }

    if (value instanceof Error) {
        return serializeErrorInstance(value, depth)
    }

    if (value === null || value === undefined) {
        return {
            name: 'Error',
            message: String(value),
        }
    }

    if (typeof value === 'string' || typeof value === 'number') {
        return {
            name: 'NonErrorThrow',
            message: String(value),
        }
    }

    try {
        return {
            name: 'NonErrorThrow',
            message: '[object]',
            meta: { preview: JSON.stringify(value).slice(0, 500) },
        }
    } catch {
        return {
            name: 'NonErrorThrow',
            message: '[unserializable object]',
        }
    }
}

function serializeErrorInstance(
    err: Error,
    depth: number,
): SerializedErrorForLog {
    const withPrisma = err as Error & {
        code?: string
        meta?: unknown
        clientVersion?: string
    }

    const out: SerializedErrorForLog = {
        name: err.name,
        message: err.message,
    }

    if (err.stack) {
        out.stack = err.stack
    }

    if (typeof withPrisma.code === 'string') {
        out.code = withPrisma.code
    }

    if (withPrisma.meta !== undefined) {
        out.meta = withPrisma.meta
    }

    if (typeof withPrisma.clientVersion === 'string') {
        out.clientVersion = withPrisma.clientVersion
    }

    if (err instanceof AggregateError && Array.isArray(err.errors)) {
        out.errors = err.errors.map((e) => serializeUnknown(e, depth + 1))
    }

    if (err.cause !== undefined && err.cause !== null) {
        out.cause = serializeUnknown(err.cause, depth + 1)
    }

    return out
}

/**
 * @param value - Typically an Error; other values get a safe fallback shape
 */
export function serializeErrorForLog(value: unknown): SerializedErrorForLog {
    return serializeUnknown(value, 0)
}
