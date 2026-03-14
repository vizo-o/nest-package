/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IncomingMessage, ServerResponse } from 'http'
import { createServer } from 'http'
import { randomUUID } from 'node:crypto'
import * as url from 'url'
import { LoggerService } from '../logger-v2'
import type { ApiEvent } from './entities'
import { isApiResponse } from './entities'

export const startLocalApiServer = async (
    handler: (event: any, context: any, callback: any) => Promise<any>,
    bootstrap: (requestId: string) => Promise<any>,
): Promise<any> => {
    const listenPort = process.env?.LOCAL_API_PORT
    if (!listenPort) {
        throw new Error('LOCAL_API_PORT is not defined')
    }
    const app = await bootstrap(randomUUID())
    const logger = app.get(LoggerService)
    logger.setContext({ service: 'LocalApiRunner' })
    logger.log('Starting local API server')

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        let requestBody = ''
        req.on('data', (chunk) => {
            requestBody += chunk
        })

        req.on('end', async () => {
            const event = createRequestApiEvent(req, requestBody)

            try {
                const context = { awsRequestId: randomUUID() }
                // Lambda callback parameter - not used in modern async Lambda handlers
                // eslint-disable-next-line no-empty-function
                const lambdaResponse = await handler(event, context, () => {})
                if (!isApiResponse(lambdaResponse)) {
                    logger.error('Invalid response from handler', {
                        response: lambdaResponse,
                    })
                    throw new Error('Invalid response from handler')
                }
                for (const key in lambdaResponse.headers) {
                    const headerValue =
                        lambdaResponse.headers[
                            key as keyof typeof lambdaResponse.headers
                        ]
                    if (headerValue !== undefined) {
                        res.setHeader(key, headerValue)
                    }
                }
                res.writeHead(lambdaResponse.statusCode)
                res.end(lambdaResponse.body)
            } catch (error) {
                logger.error(
                    `Error handling request: ${error instanceof Error ? error.message : String(error)}`,
                    error instanceof Error
                        ? {
                              stack: error.stack,
                              name: error.name,
                              message: error.message,
                          }
                        : undefined,
                )
                res.writeHead(500, { 'Content-Type': 'text/plain' })
                if (error instanceof Error) {
                    res.end(error.message)

                    return
                }
                res.end('Internal Error')
            }
        })
    })

    server.listen(listenPort, () => {
        logger.log(`Server is listening on port ${listenPort}`)
    })
}

const createRequestApiEvent = (
    request: IncomingMessage,
    body: string,
): ApiEvent => {
    // Extract path and query string parameters
    const parsedUrl = url.parse(request.url || '', true)

    const headers: Record<string, string> = {}
    for (const key in request.headers) {
        let parsedKey = key
        if (key.toLowerCase() === 'authorization') {
            parsedKey = 'Authorization'
        }

        const headerValue = request.headers[key]
        if (headerValue !== undefined) {
            headers[parsedKey] = Array.isArray(headerValue)
                ? headerValue.join(',')
                : headerValue
        }
    }

    const multiValueQueryStringParameters: Record<string, string[]> = {}

    for (const key in parsedUrl.query) {
        const value = parsedUrl.query[key]
        if (value !== undefined) {
            multiValueQueryStringParameters[key] = Array.isArray(value)
                ? value
                : [value]
        }
    }

    return {
        body,
        path: parsedUrl.pathname || '/',
        headers,
        resource: '/',
        httpMethod: request.method || 'GET',
        pathParameters: null,
        requestContext: {
            path: parsedUrl.pathname || '/backend',
            apiId: '0564ftpzy0',
            stage: 'backend',
            identity: {
                user: null,
                caller: null,
                userArn: null,
                sourceIp: request.socket.remoteAddress || 'unknown',
                accessKey: null,
                accountId: null,
                userAgent: request.headers['user-agent'] || 'unknown',
                principalOrgId: null,
                cognitoIdentityId: null,
                cognitoIdentityPoolId: null,
                cognitoAuthenticationType: null,
                cognitoAuthenticationProvider: null,
            },
            protocol: `HTTP/${request.httpVersion}`,
            accountId: '610896713610',
            requestId: '57716021-c1e1-4224-8928-4da9c24f2a11',
            domainName: '0564ftpzy0.execute-api.eu-central-1.amazonaws.com',
            httpMethod: request.method || 'GET',
            resourceId: 'l7ywmfc1ql',
            requestTime: '07/Sep/2023:15:18:20 +0000',
            domainPrefix: '0564ftpzy0',
            resourcePath: '/',
            requestTimeEpoch: 1694099900233,
            extendedRequestId: 'K5F1dGITFiAFlew=',
        },
        stageVariables: null,
        isBase64Encoded: false,
        multiValueQueryStringParameters,
    }
}
