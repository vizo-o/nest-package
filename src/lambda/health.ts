import { isApiEvent, isCognitoTriggerEvent } from '../api/entities'
import type { ApiEvent } from '../api/entities'

export const INTERNAL_HEALTH_API_PATH = '/health/internal'

export const internalHealthPathPattern = /\/health\/internal\/?$/i

export function getApiGatewayEventPath(event: ApiEvent): string {
    if (isCognitoTriggerEvent(event)) {
        return ''
    }

    return event.path || event.requestContext?.path || ''
}

export function isInternalHealthPath(path: string): boolean {
    return internalHealthPathPattern.test(path)
}

export function isInternalHealthApiEvent(event: unknown): event is ApiEvent {
    if (!isApiEvent(event) || isCognitoTriggerEvent(event)) {
        return false
    }

    return isInternalHealthPath(getApiGatewayEventPath(event))
}
