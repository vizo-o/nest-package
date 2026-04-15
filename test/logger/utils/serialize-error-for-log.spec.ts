import {
    serializeErrorForLog,
    type SerializedErrorForLog,
} from '../../../src/logger-v2/utils/serialize-error-for-log'

describe('serializeErrorForLog', () => {
    it('serializes a basic Error', () => {
        const err = new Error('failed')
        err.stack = 'Error: failed\n  at x.ts:1:1'
        const s = serializeErrorForLog(err)
        expect(s).toMatchObject({
            name: 'Error',
            message: 'failed',
            stack: 'Error: failed\n  at x.ts:1:1',
        })
    })

    it('serializes AggregateError children', () => {
        const a = new Error('a')
        const b = new Error('b')
        const agg = new AggregateError([a, b], 'many')
        const s = serializeErrorForLog(agg) as SerializedErrorForLog
        expect(s.name).toBe('AggregateError')
        expect(s.message).toBe('many')
        expect(s.errors).toHaveLength(2)
        expect(s.errors?.[0].message).toBe('a')
        expect(s.errors?.[1].message).toBe('b')
    })

    it('truncates deep cause chains', () => {
        let e: Error = new Error('depth0')
        for (let i = 1; i <= 8; i++) {
            const next = new Error(`depth${i}`)
            next.cause = e
            e = next
        }
        const s = serializeErrorForLog(e) as SerializedErrorForLog
        let cur: SerializedErrorForLog | undefined = s
        let hops = 0
        while (cur?.cause) {
            hops++
            cur = cur.cause
        }
        // MAX_CAUSE_DEPTH is 5: follow at most this many cause levels before a truncation leaf
        expect(hops).toBeLessThanOrEqual(6)
        expect(cur?.message).toContain('max depth')
    })

    it('includes Prisma-like fields when present', () => {
        class P extends Error {
            readonly code = 'P2002'
            readonly meta = { target: ['x'] }
            readonly clientVersion = '5.0.0'
            constructor() {
                super('unique')
                this.name = 'PrismaClientKnownRequestError'
            }
        }
        const s = serializeErrorForLog(new P())
        expect(s.code).toBe('P2002')
        expect(s.meta).toEqual({ target: ['x'] })
        expect(s.clientVersion).toBe('5.0.0')
    })

    it('handles non-Error throws', () => {
        expect(serializeErrorForLog('oops')).toMatchObject({
            name: 'NonErrorThrow',
            message: 'oops',
        })
        expect(serializeErrorForLog(null)).toMatchObject({
            message: 'null',
        })
    })
})
