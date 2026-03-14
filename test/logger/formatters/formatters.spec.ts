import {
    formatDevLog,
    formatProdLog,
    type FormattedLogEntry,
} from '../../../src/logger-v2/formatters/index'

describe('DevFormatter', () => {
    describe('Formatting output', () => {
        it('should format log entry with timestamp', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
            }
            const formatted = formatDevLog(entry)
            expect(formatted).toContain('Test message')
            expect(formatted).toContain('INFO')
        })

        it('should format log entry with service name', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
                service: 'TestService',
            }
            const formatted = formatDevLog(entry)
            expect(formatted).toContain('[TestService]')
        })

        it('should format log entry with request ID', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
                requestId: 'req-123',
            }
            const formatted = formatDevLog(entry)
            expect(formatted).toContain('[req-123]')
        })

        it('should format log entry with context', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
                userId: 'user-123',
                operation: 'test-op',
            }
            const formatted = formatDevLog(entry)
            expect(formatted).toContain('userId')
            expect(formatted).toContain('user-123')
            expect(formatted).toContain('operation')
            expect(formatted).toContain('test-op')
        })
    })

    describe('Context formatting', () => {
        it('should exclude standard fields from context', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
                service: 'TestService',
                requestId: 'req-123',
                customField: 'custom-value',
            }
            const formatted = formatDevLog(entry)
            expect(formatted).toContain('customField')
            expect(formatted).toContain('custom-value')
        })

        it('should format empty context correctly', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
            }
            const formatted = formatDevLog(entry)
            expect(formatted).not.toContain('{')
        })
    })
})

describe('ProdFormatter', () => {
    describe('JSON structure', () => {
        it('should format log entry as JSON', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
            }
            const formatted = formatProdLog(entry)
            const parsed = JSON.parse(formatted)
            expect(parsed.timestamp).toBe('2024-01-01T12:00:00.000Z')
            expect(parsed.level).toBe('info')
            expect(parsed.message).toBe('Test message')
        })

        it('should include service name in JSON', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
                service: 'TestService',
            }
            const formatted = formatProdLog(entry)
            const parsed = JSON.parse(formatted)
            expect(parsed.service).toBe('TestService')
        })

        it('should include request ID in JSON', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
                requestId: 'req-123',
            }
            const formatted = formatProdLog(entry)
            const parsed = JSON.parse(formatted)
            expect(parsed.requestId).toBe('req-123')
        })
    })

    describe('CloudWatch compatibility', () => {
        it('should produce valid JSON for CloudWatch', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
                service: 'TestService',
                requestId: 'req-123',
            }
            const formatted = formatProdLog(entry)
            expect(() => JSON.parse(formatted)).not.toThrow()
        })

        it('should include all context fields', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
                userId: 'user-123',
                operation: 'test-op',
            }
            const formatted = formatProdLog(entry)
            const parsed = JSON.parse(formatted)
            expect(parsed.userId).toBe('user-123')
            expect(parsed.operation).toBe('test-op')
        })
    })

    describe('Context serialization', () => {
        it('should serialize nested objects', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
                metadata: {
                    key: 'value',
                },
            }
            const formatted = formatProdLog(entry)
            const parsed = JSON.parse(formatted)
            expect(parsed.metadata).toEqual({ key: 'value' })
        })

        it('should exclude standard fields from context but include them in root', () => {
            const entry: FormattedLogEntry = {
                timestamp: '2024-01-01T12:00:00.000Z',
                level: 'info',
                message: 'Test message',
                service: 'TestService',
                requestId: 'req-123',
                customField: 'custom-value',
            }
            const formatted = formatProdLog(entry)
            const parsed = JSON.parse(formatted)
            expect(parsed.timestamp).toBeDefined()
            expect(parsed.level).toBeDefined()
            expect(parsed.message).toBeDefined()
            expect(parsed.service).toBeDefined()
            expect(parsed.requestId).toBeDefined()
            expect(parsed.customField).toBe('custom-value')
        })
    })
})
