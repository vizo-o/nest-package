import type { LoggerService, OnModuleInit } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { ModuleRef } from '@nestjs/core'
import type { Module } from '@nestjs/core/injector/module'
import type { JwtHeader, SigningKeyCallback } from 'jsonwebtoken'
import { verify } from 'jsonwebtoken'
import { JwksClient } from 'jwks-rsa'
import * as math from 'mathjs'
import { reportError, type ErrorContext } from '../aws'
import { getCognitoClientIds } from '../aws/cognito.util'
import type { ApiDaoBase } from './api.dao'
import { CONTROLLER_KEY, ROUTE_KEY } from './decorators'
import type {
    ApiEvent,
    ApiResponse,
    CognitoTokenPayload,
    CognitoTriggerEvent,
    ControllerMapping,
    ControllerMethod,
    Permission,
    QueryParams,
    RequestPayload,
    RouteMetadata,
} from './entities'
import {
    AppError,
    AuthenticationError,
    AuthorizationError,
    HttpMethod,
    NotFoundError,
    isCognitoTriggerEvent,
} from './entities'
import {
    formatErrorDetails,
    formatRequestDetails,
    getErrorMessage,
} from './error.helpers'
import type { UserServiceBase } from './user.service'

/**
 * Simple logger interface for ApiServiceBase
 * Compatible with both old VizoLoggerService and new LoggerService
 */
interface ApiLogger {
    log(message: string, context?: string): void
    error(message: string, trace?: string, context?: string): void
    warn(message: string, context?: string): void
}

@Injectable()
export abstract class ApiServiceBase implements OnModuleInit {
    customAuthEndpoints: Array<{
        path: string
        userEmail: string
        cognitoAudience?: string
        cognitoIssuer?: string
        skipBackendTokenValidation?: boolean
        getPayloadFromToken?: (
            tokenData: CognitoTokenPayload,
        ) => Record<string, unknown>
        authorizeToken?: (
            headers: Record<string, string | string[]>,
        ) => Promise<void> | void
        allowedIps?: string[]
    }> = []

    private jwksClients: Map<string, JwksClient>
    protected logger?: ApiLogger

    abstract readonly moduleRef: ModuleRef
    abstract dao: ApiDaoBase
    abstract userService: UserServiceBase
    abstract controllerModules: Module[]

    private readonly controllerMappings: ControllerMapping[] = []
    private readonly cognitoIssuer: string
    private readonly cognitoClientIdParameter: string
    private readonly cognitoClientSecretArn: string | undefined

    constructor(logger?: LoggerService) {
        if (!process.env.JWKS_URI && process.env?.SKIP_API !== 'true') {
            throw new Error('JWKS_URI not found in environment variables')
        }
        if (!process.env.COGNITO_ISSUER && process.env?.SKIP_API !== 'true') {
            throw new Error('COGNITO_ISSUER not found in environment variables')
        }
        if (
            !process.env.COGNITO_USER_POOL_CLIENT_ID_PARAMETER &&
            process.env?.SKIP_API !== 'true'
        ) {
            throw new Error(
                'COGNITO_USER_POOL_CLIENT_ID_PARAMETER not found in environment variables',
            )
        }
        this.jwksClients = new Map()
        this.jwksClients.set(
            'default',
            new JwksClient({ jwksUri: process.env.JWKS_URI as string }),
        )
        this.cognitoIssuer = process.env.COGNITO_ISSUER as string
        this.cognitoClientIdParameter = process.env
            .COGNITO_USER_POOL_CLIENT_ID_PARAMETER as string
        this.cognitoClientSecretArn = process.env.COGNITO_CLIENT_SECRET_ARN
        this.logger = logger
    }

    /**
     * Helper method to add CORS headers to API responses
     */
    private addCorsHeaders(
        headers: Record<string, string> = {},
    ): Record<string, string> {
        return {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods':
                'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            ...headers,
        }
    }

    /**
     * Helper method to log messages, falls back to console if no logger provided
     */
    private logMessage(
        level: 'log' | 'error' | 'warn',
        message: string,
        context?: string,
    ): void {
        if (this.logger) {
            if (level === 'log') {
                this.logger.log(message, context || 'ApiService')
            } else if (level === 'error') {
                this.logger.error(message, undefined, context || 'ApiService')
            } else {
                this.logger.warn(message, context || 'ApiService')
            }
        } else {
            // Fallback to console for backward compatibility
            if (level === 'log') {
                console.log(message)
            } else if (level === 'error') {
                console.error(message)
            } else {
                console.warn(message)
            }
        }
    }

    addJwksClient(clientName: string, jwksUri: string): void {
        this.jwksClients.set(clientName, new JwksClient({ jwksUri }))
    }

    onModuleInit() {
        // Internal services:
        this.addControllerMappings(
            this.userService.constructor as typeof Object,
        )

        // Application services:
        for (const importedModule of this.controllerModules) {
            const controllerServices =
                this.getControllerServices(importedModule)

            for (const service of controllerServices) {
                this.addControllerMappings(service)
            }
        }
    }

    private getJwk(header: JwtHeader, callback: SigningKeyCallback) {
        const clientEntries = Array.from(this.jwksClients.entries())

        const tryNextClient = (index = 0) => {
            if (index >= clientEntries.length) {
                this.logMessage(
                    'error',
                    'No matching key found in any JWKS client',
                )

                return callback(new Error('Invalid key'))
            }

            const [_clientName, client] = clientEntries[index]
            client.getSigningKey(header.kid, (err, key) => {
                if (err) {
                    return tryNextClient(index + 1)
                }
                if (!key) {
                    return tryNextClient(index + 1)
                }

                try {
                    const signingKey = key?.getPublicKey()

                    return callback(null, signingKey)
                } catch {
                    return tryNextClient(index + 1)
                }
            })
        }

        tryNextClient()
    }

    private validateAndDecodeToken(
        idToken: string,
        cognitoAudience: string | string[],
        cognitoIssuer: string,
    ): Promise<CognitoTokenPayload> {
        return new Promise((resolve, reject) => {
            const audience: string | [string, ...string[]] = Array.isArray(
                cognitoAudience,
            )
                ? cognitoAudience.length > 0
                    ? (cognitoAudience as [string, ...string[]])
                    : cognitoAudience[0]
                : cognitoAudience

            verify(
                idToken,
                this.getJwk.bind(this),
                {
                    algorithms: ['RS256'],
                    audience,
                    issuer: cognitoIssuer,
                },
                (err: unknown, decoded: unknown) => {
                    if (err) {
                        reject(new AuthenticationError(`Invalid token: ${err}`))
                    } else {
                        resolve(decoded as CognitoTokenPayload)
                    }
                },
            )
        })
    }

    private getControllerServices(
        importedModule: Module,
    ): Array<typeof Object> {
        return (
            Reflect.getMetadata('exports', importedModule as object) as Array<
                typeof Object
            >
        ).filter((item) => Reflect.getMetadata(CONTROLLER_KEY, item.prototype))
    }

    private addControllerMappings(service: typeof Object): void {
        const controllerName = Reflect.getMetadata(
            CONTROLLER_KEY,
            service.prototype,
        )
        const serviceInstance = this.moduleRef.get(service, {
            strict: false,
        }) as Record<string, unknown> | null

        if (serviceInstance && controllerName) {
            const routes =
                (Reflect.getMetadata(
                    ROUTE_KEY,
                    service.prototype,
                ) as RouteMetadata<
                    (params: unknown) => Promise<ApiResponse>
                >[]) || []

            for (const route of routes) {
                this.addSingleControllerMapping(
                    serviceInstance,
                    controllerName,
                    route,
                )
            }
        }
    }

    private addSingleControllerMapping(
        serviceInstance: Record<string, unknown>,
        controllerName: string,
        route: RouteMetadata<(params: unknown) => Promise<ApiResponse>>,
    ): void {
        const { method, path, permissionGenerator, httpMethod } = route

        if (!method || typeof method !== 'function') {
            this.logMessage(
                'warn',
                `Method not found in service for controller: ${controllerName}`,
            )

            return
        }

        const boundMethod = method.bind(serviceInstance)
        const controllerString = `/${controllerName}${
            path.startsWith('/') ? '' : '/'
        }${path}`

        this.controllerMappings.push({
            controllerString,
            httpMethod,
            boundMethod,
            permissionGenerator,
        })
    }

    handleCognitoTriggerEvent(
        event: CognitoTriggerEvent,
    ): Promise<CognitoTriggerEvent> {
        return this.userService.checkUserAllowedToSignup(event)
    }

    async handleEvent(event: ApiEvent): Promise<ApiResponse> {
        if (isCognitoTriggerEvent(event)) {
            return this.handleCognitoTriggerEvent(
                event,
            ) as unknown as Promise<ApiResponse>
        }

        // Handle CORS preflight OPTIONS requests
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                body: '',
                headers: this.addCorsHeaders({
                    'Access-Control-Max-Age': '86400',
                }),
            }
        }

        this.logMessage(
            'log',
            `Received ${event.httpMethod} API call to route ${event.path}`,
        )
        const startTime = performance.now()
        let userEmail: string | null = null
        let requiredPermission: Permission | null = null
        let payload: RequestPayload | null = null
        const queryParams: QueryParams = {}

        try {
            if (
                !Object.values(HttpMethod).includes(
                    event.httpMethod as HttpMethod,
                )
            ) {
                throw new Error(`Invalid httpMethod ${event.httpMethod}`)
            }

            const basePayload = this.buildPayloadFromEvent(event)
            const eventDispatcher = this.buildEventDispatcher(
                event.path,
                event.httpMethod as HttpMethod,
                basePayload,
            )

            payload = eventDispatcher ? eventDispatcher.payload : basePayload

            if (!eventDispatcher) {
                throw new NotFoundError(
                    `Invalid request ${event.httpMethod} on ${event.path}`,
                )
            }

            const { boundMethod, permissionGenerator } = eventDispatcher

            if (!permissionGenerator) {
                throw new Error(
                    'permissionGenerator not found for eventDispatcher',
                )
            }

            if (event.multiValueQueryStringParameters) {
                Object.entries(event.multiValueQueryStringParameters).forEach(
                    ([key, value]) => {
                        if (!value || value.length === 0) return
                        const firstValue = value[0]
                        const hasLeadingPlus = firstValue.startsWith('+')
                        const isNumber =
                            !hasLeadingPlus && !isNaN(Number(firstValue))
                        const isBoolean =
                            firstValue === 'true' || firstValue === 'false'
                        const isString =
                            hasLeadingPlus || (!isNumber && !isBoolean)

                        if (isNumber) {
                            queryParams[key] = Number(firstValue)
                        } else if (isBoolean) {
                            queryParams[key] = firstValue === 'true'
                        } else if (isString) {
                            queryParams[key] = firstValue
                        } else {
                            throw new Error(
                                `Invalid query parameter type for ${key}`,
                            )
                        }
                    },
                )
            }

            const {
                userRoles,
                requiredPermission: authorizedRequiredPermission,
                userEmail: authorizedUserEmail,
                tokenPayload,
            } = await this.authorizeRequest(event, permissionGenerator, payload)
            userEmail = authorizedUserEmail
            requiredPermission = authorizedRequiredPermission

            payload = {
                ...payload,
                tokenPayload,
                queryParams,
                userEmail,
                userRoles,
                headers: event.headers,
            } as RequestPayload

            const methodOutput = await boundMethod(payload)
            const endTime = performance.now()

            await this.dao.createAccessLog({
                user: { connect: { email: userEmail } },
                resource: authorizedRequiredPermission.resource,
                action: authorizedRequiredPermission.action,
                payload: JSON.stringify(payload),
                path: event.path,
                method: event.httpMethod,
                statusCode: 200,
                duration: math.round(endTime - startTime),
            })

            return {
                statusCode: 200,
                body: JSON.stringify(methodOutput),
                headers: this.addCorsHeaders({
                    'Content-Type': 'application/json',
                }),
            }
        } catch (err) {
            const errorMessage =
                err instanceof Error ? err.message : String(err)
            this.logMessage('error', `Error in handleEvent: ${errorMessage}`)

            // Report all errors to admin system (admin system will handle filtering and notification rules)
            // Get request ID from logger if available (new LoggerService)
            let requestId: string | undefined
            if (
                this.logger &&
                typeof (
                    this.logger as unknown as {
                        getRequestId?: () => string | undefined
                    }
                ).getRequestId === 'function'
            ) {
                requestId = (
                    this.logger as unknown as {
                        getRequestId: () => string | undefined
                    }
                ).getRequestId()
            }

            // Build error context
            const errorDetails = formatErrorDetails(err)
            const requestDetails = formatRequestDetails(
                userEmail || 'Unknown user',
                requiredPermission,
                payload,
                event,
            )

            // Determine severity from error details
            let severity: 'low' | 'medium' | 'high' | 'critical' = 'high'
            if (errorDetails.severity === 'CRITICAL') {
                severity = 'critical'
            } else if (errorDetails.severity === 'WARNING') {
                severity = 'medium'
            } else if (errorDetails.severity === 'INFO') {
                severity = 'low'
            }

            // Build endpoint string
            const endpoint =
                'httpMethod' in event && 'path' in event
                    ? `${event.httpMethod} ${event.path}`
                    : undefined

            const errorContext: ErrorContext = {
                service: process.env.APP_NAME,
                requestId,
                endpoint,
                userId: userEmail || undefined,
                title: `${errorDetails.type}: ${errorDetails.message}`,
                description: `API error occurred at ${requestDetails.endpointInfo}`,
                severity,
                category: 'api_error',
                metadata: {
                    userInfo: requestDetails.userInfo,
                    permissionInfo: requestDetails.permissionInfo,
                    locationInfo: requestDetails.locationInfo,
                    payloadInfo: requestDetails.payloadInfo,
                    statusCode: errorDetails.statusCode,
                    errorType: errorDetails.type,
                    ...(errorDetails.cause && {
                        cause: errorDetails.cause,
                    }),
                },
            }

            await reportError(err, errorContext)

            const errorString = getErrorMessage(err)
            const statusCode = err instanceof AppError ? err.status : 500

            const endTime = performance.now()

            await this.dao.createAccessLog({
                ...(userEmail && { user: { connect: { email: userEmail } } }),
                resource: requiredPermission?.resource || 'unknown',
                action: requiredPermission?.action || 'unknown',
                payload: JSON.stringify(payload) || JSON.stringify({}),
                path: event.path,
                method: event.httpMethod,
                statusCode,
                error: errorString,
                duration: Math.round(endTime - startTime),
            })

            return {
                headers: this.addCorsHeaders(),
                statusCode,
                body: JSON.stringify({ error: errorString }),
            }
        }
    }

    private async authorizeRequest(
        event: {
            path: string
            headers: Record<string, string | string[]>
            requestContext?: {
                identity?: {
                    sourceIp?: string
                }
            }
        },
        permissionGenerator: (
            params: Record<string, string> | RequestPayload,
        ) => {
            resource: string
            action: string
        },
        payload: RequestPayload,
    ): Promise<{
        requiredPermission: { resource: string; action: string }
        userRoles: string[]
        userEmail: string
        tokenPayload?: Record<string, unknown>
    }> {
        const healthInternalPath = /\/health\/internal\/?$/i.test(event.path)
        if (
            healthInternalPath &&
            process.env.ENABLE_HEALTH_SMOKE_BYPASS === 'true'
        ) {
            const requiredPermission = permissionGenerator(payload)
            return {
                requiredPermission,
                userRoles: ['health_test'],
                userEmail:
                    process.env.HEALTH_SMOKE_TEST_USER_EMAIL ??
                    'health-test@vizo-o.com',
            }
        }

        const customAuthEndpoint = this.customAuthEndpoints.find((endpoint) =>
            event.path.startsWith(endpoint.path),
        )

        // Check IP whitelist if configured
        if (customAuthEndpoint?.allowedIps) {
            const sourceIp =
                event.requestContext?.identity?.sourceIp ||
                (event.headers['x-forwarded-for'] as string)
                    ?.split(',')[0]
                    ?.trim() ||
                (event.headers['X-Forwarded-For'] as string)
                    ?.split(',')[0]
                    ?.trim()

            if (!sourceIp) {
                throw new AuthenticationError(
                    'Unable to determine source IP address',
                )
            }

            const isDev =
                process.env.ENV === 'dev' || process.env.ENV === 'local'
            const isAllowed =
                customAuthEndpoint.allowedIps.includes('*') && isDev
                    ? true
                    : customAuthEndpoint.allowedIps.includes(sourceIp)

            if (!isAllowed) {
                throw new AuthenticationError(
                    `IP address ${sourceIp} is not allowed`,
                )
            }
        }

        let authenticatedUserEmail
        let tokenPayload
        let cognitoAudience: string | string[] = ''
        let cognitoIssuer = this.cognitoIssuer
        if (customAuthEndpoint) {
            authenticatedUserEmail = customAuthEndpoint.userEmail
        }

        // If authorizeToken is provided, use it instead of default Cognito validation
        if (customAuthEndpoint?.authorizeToken) {
            await customAuthEndpoint.authorizeToken(event.headers)
            // After custom auth succeeds, set user email if not already set
            if (!authenticatedUserEmail) {
                authenticatedUserEmail = customAuthEndpoint.userEmail
            }
        } else if (!customAuthEndpoint?.skipBackendTokenValidation) {
            const rawAuthHeader = Array.isArray(event.headers?.Authorization)
                ? event.headers?.Authorization?.[0]
                : event.headers?.Authorization
            const idToken = (
                typeof rawAuthHeader === 'string'
                    ? rawAuthHeader.replace(/^Bearer\s+/i, '')
                    : ''
            ).trim()
            const hasIdToken = Boolean(idToken)

            const env = process.env?.ENV || ''
            const localVizoStubAllowed =
                env === 'local' &&
                Boolean(process.env.LOCAL_DEV_CUSTOMER_VIZO_ID) &&
                Boolean(customAuthEndpoint?.getPayloadFromToken)
            const shouldSkipTokenValidation =
                !hasIdToken &&
                ((['dev', 'local'].includes(env) &&
                    Boolean(
                        process.env.LOCAL_OVERRIDE_TOKEN_CHECK_WITH_EMAIL,
                    )) ||
                    localVizoStubAllowed)

            if (!shouldSkipTokenValidation) {
                // Only fetch client IDs if we're actually going to validate tokens
                if (
                    customAuthEndpoint?.cognitoAudience &&
                    customAuthEndpoint?.cognitoIssuer
                ) {
                    cognitoAudience = customAuthEndpoint.cognitoAudience
                    cognitoIssuer = customAuthEndpoint.cognitoIssuer
                } else {
                    // Read from Secrets Manager metadata (supports overlap period) or SSM parameter at runtime
                    // This allows automatic updates when client rotates and supports both old and new client IDs during overlap
                    try {
                        const { current, previous } = await getCognitoClientIds(
                            this.cognitoClientSecretArn,
                            this.cognitoClientIdParameter,
                        )
                        // Support both client IDs during overlap period
                        cognitoAudience = previous
                            ? [current, previous]
                            : current
                    } catch (error) {
                        throw new AuthenticationError(
                            `Failed to get Cognito client ID from SSM/Secrets Manager: ${error}`,
                        )
                    }
                }
            }

            if (!hasIdToken && env !== 'local') {
                throw new AuthenticationError(
                    'The request did not pass any authorizer.',
                )
            }

            if (!hasIdToken && env === 'local' && !shouldSkipTokenValidation) {
                throw new AuthenticationError(
                    'The request did not pass any authorizer.',
                )
            }

            const tokenData = shouldSkipTokenValidation
                ? {
                      email:
                          process.env.LOCAL_OVERRIDE_TOKEN_CHECK_WITH_EMAIL ||
                          '',
                  }
                : await this.validateAndDecodeToken(
                      idToken,
                      cognitoAudience,
                      cognitoIssuer,
                  )

            if (customAuthEndpoint?.getPayloadFromToken) {
                tokenPayload = customAuthEndpoint.getPayloadFromToken(tokenData)
            } else {
                const tokenUserEmail = tokenData.email
                if (tokenUserEmail) {
                    authenticatedUserEmail = tokenUserEmail
                }
            }
        }

        if (!authenticatedUserEmail) {
            throw new Error('User email not found')
        }

        const requiredPermission = permissionGenerator(payload)
        const { actionIsPermitted, userRoles } =
            await this.userService.getUserAuthorizationData(
                authenticatedUserEmail,
                requiredPermission.resource,
                requiredPermission.action,
            )

        if (!actionIsPermitted) {
            throw new AuthorizationError(
                `User ${authenticatedUserEmail} is not allowed to perform ${requiredPermission.action} on ${requiredPermission.resource}`,
            )
        }

        return {
            requiredPermission,
            userRoles,
            userEmail: authenticatedUserEmail,
            tokenPayload,
        }
    }

    /**
     * Build the request payload from the raw API event (body + headers)..
     */
    private buildPayloadFromEvent(event: {
        body: string | null
        headers?: { [key: string]: string | string[] }
    }): RequestPayload {
        const payload: RequestPayload = {
            headers: event.headers ?? {},
            userEmail: '',
            userRoles: [],
        }
        const body = event.body
        if (body) {
            const contentType =
                event.headers?.['content-type'] ||
                event.headers?.['Content-Type']
            const contentTypeStr = Array.isArray(contentType)
                ? contentType[0]
                : contentType

            if (contentTypeStr?.includes('application/x-www-form-urlencoded')) {
                const formData = new URLSearchParams(body)
                const formObject: Record<string, unknown> = {}
                for (const [key, value] of formData.entries()) {
                    formObject[key] = value
                }
                payload.body = formObject
            } else {
                try {
                    payload.body = JSON.parse(body) as Record<string, unknown>
                } catch {
                    payload.body = { _raw: body }
                }
            }
        }

        return payload
    }

    /**
     * Resolve the route for the given path and method, and return the payload
     * enriched with path params when a single route matches.
     */
    buildEventDispatcher(
        path: string,
        httpMethod: HttpMethod,
        basePayload: RequestPayload,
    ): {
        boundMethod: ControllerMethod
        payload: RequestPayload
        permissionGenerator?: (
            params: Record<string, string> | RequestPayload,
        ) => {
            resource: string
            action: string
        }
    } | null {
        const matches: {
            controllerString: string
            boundMethod: ControllerMethod
            payload: RequestPayload
            permissionGenerator?: (
                params: Record<string, string> | RequestPayload,
            ) => {
                resource: string
                action: string
            }
        }[] = []

        function normalizePath(p: string): string {
            return p.replace(/^\/+|\/+$/g, '') // Removes leading and trailing slashes
        }

        const normalizedPath = normalizePath(path)

        for (const mapping of this.controllerMappings) {
            if (mapping.httpMethod !== httpMethod) {
                continue
            }

            const segments = normalizePath(mapping.controllerString).split('/')
            const pathSegments = normalizedPath.split('/')

            if (segments.length !== pathSegments.length) {
                continue
            }

            const pathParams: Record<string, string> = {}
            let isMatch = true

            for (let i = 0; i < segments.length; i++) {
                if (segments[i].startsWith(':')) {
                    const paramName = segments[i].slice(1) // Remove the ':' prefix
                    pathParams[paramName] = pathSegments[i]
                } else if (segments[i] !== pathSegments[i]) {
                    isMatch = false
                    break
                }
            }

            if (isMatch) {
                const { boundMethod, permissionGenerator } = mapping
                matches.push({
                    controllerString: mapping.controllerString,
                    boundMethod,
                    payload: { ...basePayload, ...pathParams },
                    permissionGenerator,
                })
            }
        }

        if (matches.length === 1) {
            return matches[0]
        } else if (matches.length > 1) {
            // Sort by specificity - exact matches first, then by number of parameters
            matches.sort((a, b) => {
                const aParams = (a.controllerString.match(/:/g) || []).length
                const bParams = (b.controllerString.match(/:/g) || []).length

                return aParams - bParams // Fewer parameters = more specific
            })

            return matches[0] // Return the most specific match
        }

        return null // No matches found
    }
}
