import type { EventResponse } from '../event/entities'

export enum HttpMethod {
    GET = 'GET',
    POST = 'POST',
    PUT = 'PUT',
    PATCH = 'PATCH',
    DELETE = 'DELETE',
}

export type ApiResponse = {
    statusCode: number
    body: string
    headers?: Record<string, string>
}

export type ApiEvent =
    | {
          body: string | null
          path: string
          headers: { [key: string]: string | string[] }
          resource: string
          httpMethod: string
          pathParameters: { [key: string]: string } | null
          requestContext: {
              path: string
              apiId: string
              stage: string
              identity: {
                  user: string | null
                  caller: string | null
                  userArn: string | null
                  sourceIp: string
                  accessKey: string | null
                  accountId: string | null
                  userAgent: string
                  principalOrgId: string | null
                  cognitoIdentityId: string | null
                  cognitoIdentityPoolId: string | null
                  cognitoAuthenticationType: string | null
                  cognitoAuthenticationProvider: string | null
              }
              protocol: string
              accountId: string
              requestId: string
              domainName: string
              httpMethod: string
              resourceId: string
              requestTime: string
              domainPrefix: string
              resourcePath: string
              requestTimeEpoch: number
              extendedRequestId: string
          }
          stageVariables: { [key: string]: string } | null
          isBase64Encoded: boolean
          multiValueQueryStringParameters: { [key: string]: string[] } | null
      }
    | CognitoTriggerEvent

export const isCognitoTriggerEvent = (
    event: unknown,
): event is CognitoTriggerEvent => {
    return (
        typeof event === 'object' &&
        event !== null &&
        typeof (event as CognitoTriggerEvent).userPoolId === 'string' &&
        typeof (event as CognitoTriggerEvent).triggerSource === 'string' &&
        (event as CognitoTriggerEvent).request !== undefined &&
        typeof (event as CognitoTriggerEvent).request.userAttributes ===
            'object' &&
        (event as CognitoTriggerEvent).request.userAttributes !== null &&
        typeof (event as CognitoTriggerEvent).request.userAttributes.email ===
            'string'
    )
}

export const isApiEvent = (event: unknown): event is ApiEvent => {
    if (isCognitoTriggerEvent(event)) {
        return true
    }

    return (
        (event as ApiEvent)?.['httpMethod' as keyof ApiEvent] !== undefined &&
        (event as ApiEvent)?.['headers' as keyof ApiEvent] !== undefined
    )
}

export const isApiResponse = (obj: unknown): obj is ApiResponse => {
    return (
        obj !== null &&
        obj !== undefined &&
        (obj as ApiResponse).statusCode !== undefined &&
        (obj as ApiResponse).headers !== undefined
    )
}

export interface IApiPrismaService {
    accessLog: {
        create: (event: unknown) => Promise<{ id: string }>
    }
    user: {
        create: (user: unknown) => unknown
        findUnique: (user: unknown) => unknown
        update: (user: unknown) => unknown
        delete: (user: unknown) => unknown
    }
    permission: {
        findMany: (user: unknown) => unknown
    }
}

export type RouteMetadata<T extends (params: unknown) => unknown> = {
    path: string
    httpMethod: HttpMethod
    method: T
    permissionGenerator?: T extends (params: infer P) => unknown
        ? (params: P) => { resource: string; action: string }
        : never
}

export type QueryParams = Record<string, string | number | boolean>

export interface Permission {
    action: string
    resource: string
}

export interface ErrorDetails {
    type: string
    message: string
    statusCode: number
    severity: 'CRITICAL' | 'WARNING' | 'INFO'
    cause: string | null
    stackTrace: string | null
}
export interface RequestPayload {
    body?: {
        sessionId?: string
        [key: string]: unknown
    }
    headers: Record<string, string | string[]>
    queryParams?: QueryParams
    userEmail: string
    userRoles: string[]
    tokenPayload?: Record<string, unknown>
    [key: string]: unknown
}

export type ControllerMethod = (
    params: Record<string, string> | RequestPayload,
) => unknown

export type ControllerMapping = {
    controllerString: string
    httpMethod: HttpMethod
    boundMethod: ControllerMethod
    permissionGenerator?: (params: Record<string, string> | RequestPayload) => {
        resource: string
        action: string
    }
}

export type ChainedParams<
    S extends string,
    IncludeBody extends boolean,
    Acc extends Record<string, unknown> = IncludeBody extends true
        ? { body: never }
        : NonNullable<unknown>,
> = S extends `${string}:${infer Param}/${infer Rest}`
    ? ChainedParams<Rest, IncludeBody, Acc & { [K in Param]: string }>
    : S extends `${string}:${infer Param}`
      ? Acc & { [K in Param]: string }
      : Acc

export type MergeParams<T extends Record<string, unknown>> = {
    [K in keyof T]: T[K]
}

export type ExtractRouteParams<
    S extends string,
    IncludeBody extends boolean,
> = MergeParams<
    ChainedParams<S, IncludeBody> & {
        queryParams: never
        userEmail: string
        userRoles: string[]
        headers: Record<string, string>
        tokenPayload: Record<string, unknown>
    }
>

export type CognitoTokenPayload = { email: string }

export class AppError extends Error {
    status: number
    notifyAdmin = true

    constructor(message: string, status: number) {
        super(message)
        this.status = status
        Object.setPrototypeOf(this, AppError.prototype)
    }
}
export class AuthenticationError extends AppError {
    constructor(message: string) {
        super(message, 401) // Unauthorized
        Object.setPrototypeOf(this, AuthenticationError.prototype)
    }
}

/**
 * Expected client auth failures (e.g. expired session on an embedded view).
 * Same HTTP semantics as AuthenticationError but does not enqueue admin incidents.
 */
export class SilentAuthenticationError extends AuthenticationError {
    notifyAdmin = false

    constructor(message: string) {
        super(message)
        Object.setPrototypeOf(this, SilentAuthenticationError.prototype)
    }
}

export class AuthorizationError extends AppError {
    constructor(message: string) {
        super(message, 403)
        Object.setPrototypeOf(this, AuthorizationError.prototype)
    }
}

export class DataSharingApprovalError extends AppError {
    notifyAdmin = false
    canSendAgainInSeconds?: number
    constructor(message: string, canSendAgainInSeconds?: number) {
        super(message, 451) // Unavailable For Legal Reasons
        this.canSendAgainInSeconds = canSendAgainInSeconds
        Object.setPrototypeOf(this, DataSharingApprovalError.prototype)
    }
}

export class NotFoundError extends AppError {
    constructor(message: string) {
        super(message, 404)
        Object.setPrototypeOf(this, NotFoundError.prototype)
    }
}

export class ConflictError extends AppError {
    constructor(message: string) {
        super(message, 409)
        Object.setPrototypeOf(this, ConflictError.prototype)
    }
}

export class MisdirectedError extends AppError {
    constructor(message: string) {
        super(message, 421)
        Object.setPrototypeOf(this, MisdirectedError.prototype)
    }
}

export class LockedError extends AppError {
    constructor(message: string) {
        super(message, 423)
        Object.setPrototypeOf(this, LockedError.prototype)
    }
}

export class RateLimitError extends AppError {
    constructor(
        message: string,
        public readonly retryAfter: number,
    ) {
        super(message, 429)
        Object.setPrototypeOf(this, RateLimitError.prototype)
    }
}

export const apiErrorFromEventResponse = (eventResponse: EventResponse) => {
    if (
        eventResponse.statusCode === 500 &&
        eventResponse.data?.errorMessage &&
        typeof eventResponse.data.errorMessage === 'string'
    ) {
        let statusCode
        try {
            statusCode = JSON.parse(eventResponse.data.errorMessage).statusCode
        } catch {
            statusCode = 500
        }
        if (statusCode) {
            eventResponse.statusCode = statusCode
        }
    }
    switch (eventResponse.statusCode) {
        case 200:
            return null
        case 401:
            return new AuthenticationError(eventResponse.message)
        case 403:
            return new AuthorizationError(eventResponse.message)
        case 404:
            return new NotFoundError(eventResponse.message)
        case 409:
            return new ConflictError(eventResponse.message)
        default:
            return new Error(eventResponse.message)
    }
}

export type CognitoTriggerEvent = {
    region: string
    request: CognitoRequest
    version: string
    response: CognitoResponse
    userName: string
    userPoolId: string
    callerContext: CallerContext
    triggerSource: string
}

type CognitoRequest = {
    userAttributes: {
        email: string
    }
    validationData: null | Record<string, unknown>
}

type CognitoResponse = {
    autoConfirmUser: boolean
    autoVerifyEmail: boolean
    autoVerifyPhone: boolean
}

type CallerContext = {
    clientId: string
    awsSdkVersion: string
}
