import type { INestApplicationContext } from '@nestjs/common'
import { EventBaseTypes } from '../event/entities'

export type SmokeTestHandlerResult = {
    statusCode: number
    body: string
}

export type RunSmokeTestOptions = {
    serviceName: string
    verifyDependencies?: (
        app: INestApplicationContext,
    ) => Promise<void> | void
}

export function isSmokeTestEvent(event: unknown): boolean {
    return (
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        (event as { type: string }).type === EventBaseTypes.SMOKE_TEST
    )
}

export async function runSmokeTest(
    app: INestApplicationContext,
    options: RunSmokeTestOptions,
): Promise<SmokeTestHandlerResult> {
    if (options.verifyDependencies) {
        await options.verifyDependencies(app)
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            status: 'ok',
            service: options.serviceName,
            timestamp: new Date().toISOString(),
        }),
    }
}
