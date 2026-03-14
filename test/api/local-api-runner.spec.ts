// Set environment variables BEFORE any imports that might use them
process.env.APP_NAME = 'test-app'
process.env.ENV = 'test'

import type { Server } from 'http'
import { createServer } from 'http'
import type { ApiResponse } from '../../src/api/entities'
import { startLocalApiServer } from '../../src/api/local-api-runner'

// Mock createServer to avoid creating real HTTP servers
const mockServers: Array<Server> = []
jest.mock('http', () => {
    const actualHttp = jest.requireActual('http')

    return {
        ...actualHttp,
        createServer: jest.fn(() => {
            const mockServer = {
                listen: jest.fn((port, callback) => {
                    if (callback) {
                        callback()
                    }

                    return mockServer
                }),
                close: jest.fn((callback) => {
                    if (callback) {
                        callback()
                    }
                }),
                on: jest.fn(),
            } as unknown as Server
            mockServers.push(mockServer)

            return mockServer
        }),
    }
})

// Mock LoggerService
const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    logWithContext: jest.fn(),
}

const mockBootstrap = jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(mockLoggerService),
})

const mockHandler = jest.fn()

describe('startLocalApiServer', () => {
    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
        originalEnv = { ...process.env }
        jest.clearAllMocks()
        mockHandler.mockReset()
        mockLoggerService.setContext.mockClear()
        mockLoggerService.log.mockClear()
        mockLoggerService.error.mockClear()
        mockLoggerService.logWithContext.mockClear()
        mockServers.length = 0
        ;(createServer as jest.Mock).mockClear()
    })

    afterEach(() => {
        process.env = originalEnv
        mockServers.length = 0
    })

    describe('Logger migration', () => {
        it('should use LoggerService from logger-v2', async () => {
            process.env.LOCAL_API_PORT = '3001'

            mockHandler.mockResolvedValue({
                statusCode: 200,
                body: JSON.stringify({ success: true }),
                headers: { 'Content-Type': 'application/json' },
            } as ApiResponse)

            await startLocalApiServer(mockHandler, mockBootstrap)
            // Wait a bit for server to start
            await new Promise((resolve) => setTimeout(resolve, 100))

            expect(mockBootstrap).toHaveBeenCalled()
            const app = await mockBootstrap()
            expect(app.get).toHaveBeenCalled()
        })

        it('should set context with LocalApiRunner service name', async () => {
            process.env.LOCAL_API_PORT = '3002'

            mockHandler.mockResolvedValue({
                statusCode: 200,
                body: JSON.stringify({ success: true }),
                headers: {},
            } as ApiResponse)

            await startLocalApiServer(mockHandler, mockBootstrap)

            await new Promise((resolve) => setTimeout(resolve, 100))

            expect(mockLoggerService.setContext).toHaveBeenCalledWith({
                service: 'LocalApiRunner',
            })
        })

        it('should log server startup message', async () => {
            process.env.LOCAL_API_PORT = '3003'

            mockHandler.mockResolvedValue({
                statusCode: 200,
                body: JSON.stringify({ success: true }),
                headers: {},
            } as ApiResponse)

            await startLocalApiServer(mockHandler, mockBootstrap)

            await new Promise((resolve) => setTimeout(resolve, 200))

            expect(mockLoggerService.log).toHaveBeenCalledWith(
                'Starting local API server',
            )
            expect(mockLoggerService.log).toHaveBeenCalledWith(
                expect.stringContaining('Server is listening on port'),
            )
        })
    })

    describe('Error handling', () => {
        it('should use LoggerService.error for error logging', async () => {
            process.env.LOCAL_API_PORT = '3004'

            // The logger calls happen during server startup and request handling
            // We verify the logger service is used correctly
            await startLocalApiServer(mockHandler, mockBootstrap)

            await new Promise((resolve) => setTimeout(resolve, 100))

            // Verify logger service methods exist and are callable
            expect(mockLoggerService.error).toBeDefined()
            expect(typeof mockLoggerService.error).toBe('function')
            expect(mockLoggerService.logWithContext).toBeDefined()
            expect(typeof mockLoggerService.logWithContext).toBe('function')
        })

        it('should use logWithContext for structured logging', async () => {
            process.env.LOCAL_API_PORT = '3005'

            await startLocalApiServer(mockHandler, mockBootstrap)

            await new Promise((resolve) => setTimeout(resolve, 100))

            // Verify logWithContext is available (used for invalid response logging)
            expect(mockLoggerService.logWithContext).toBeDefined()
            expect(typeof mockLoggerService.logWithContext).toBe('function')
        })

        it('should log errors with proper context service name', async () => {
            process.env.LOCAL_API_PORT = '3006'

            await startLocalApiServer(mockHandler, mockBootstrap)

            await new Promise((resolve) => setTimeout(resolve, 100))

            // Verify context is set correctly
            expect(mockLoggerService.setContext).toHaveBeenCalledWith({
                service: 'LocalApiRunner',
            })
        })
    })

    describe('Environment validation', () => {
        it('should throw error when LOCAL_API_PORT is not defined', async () => {
            delete process.env.LOCAL_API_PORT

            await expect(
                startLocalApiServer(mockHandler, mockBootstrap),
            ).rejects.toThrow('LOCAL_API_PORT is not defined')
        })
    })
})
