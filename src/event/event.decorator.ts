import cron from 'cron-validate'
import 'reflect-metadata'
import type {
    EventResponse,
    FileEventPayload,
    FileEventResponse,
} from './entities'
import { EventBaseTypes, createScheduleEventKey } from './entities'

export const EVENT_HANDLER_METADATA_KEY = Symbol('EVENT_HANDLER_METADATA_KEY')
export const EventRegistry = new Set<string>()

const ScheduleEnabledEnvsRegistry = new Map<string, string[]>()

const normalizeEnabledEnvs = (
    enabledEnvs?: string | string[],
): string[] | undefined => {
    if (!enabledEnvs) {
        return undefined
    }

    return Array.isArray(enabledEnvs) ? enabledEnvs : [enabledEnvs]
}

export const getCurrentScheduleEnv = (): string =>
    process.env.ENV || process.env.NODE_ENV || 'unknown'

export const isScheduleEnabledForEnv = (
    eventKey: string,
    env: string = getCurrentScheduleEnv(),
): boolean => {
    const enabledEnvs = ScheduleEnabledEnvsRegistry.get(eventKey)
    if (!enabledEnvs) {
        return true
    }

    return enabledEnvs.includes(env)
}

export function EventHandler(): ClassDecorator {
    return (target) => {
        if (typeof target !== 'function') {
            throw new Error('Target is not a class.')
        }
        Reflect.defineMetadata(EVENT_HANDLER_METADATA_KEY, true, target)
    }
}

export function OnEventBase<EventEnum, Event>(event: EventEnum) {
    return function (
        target: object,
        key: string | symbol,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        descriptor: TypedPropertyDescriptor<(event: Event) => Promise<any>>,
    ) {
        Reflect.defineMetadata(
            event,
            [
                ...(Reflect.getMetadata(
                    event as string,
                    target[key as keyof object],
                ) ?? []),
                descriptor.value,
            ],
            target,
            key,
        )

        EventRegistry.add(event as string)

        return descriptor
    }
}

export function createOnEventDecorator<EventEnum, Event>() {
    return <T extends EventEnum>(event: T) => {
        return OnEventBase<EventEnum, Event>(event as EventEnum)
    }
}

export function Schedule(
    cronString: string,
    options?: { enabledEnvs: string | string[] },
) {
    const validationResult = cron(cronString)
    if (!validationResult.isValid()) {
        throw new Error(
            `Invalid cron string: ${cronString} - ${validationResult.getError()}`,
        )
    }

    const event = createScheduleEventKey(cronString)
    const enabledEnvs = normalizeEnabledEnvs(options?.enabledEnvs)
    if (enabledEnvs !== undefined) {
        ScheduleEnabledEnvsRegistry.set(event, enabledEnvs)
    }

    return function (
        target: object,
        key: string | symbol,
        descriptor: TypedPropertyDescriptor<() => Promise<EventResponse>>,
    ) {
        Reflect.defineMetadata(
            event,
            [
                ...(Reflect.getMetadata(event, target[key as keyof object]) ??
                    []),
                descriptor.value,
            ],
            target,
            key,
        )

        EventRegistry.add(event)

        return descriptor
    }
}

export function OnFile(predicate: (fileName: string) => boolean) {
    return function (
        target: object,
        key: string | symbol,
        descriptor: TypedPropertyDescriptor<
            (payload: FileEventPayload) => Promise<FileEventResponse>
        >,
    ) {
        const existingHandlers =
            Reflect.getMetadata(
                EventBaseTypes.FILE_UPLOADED,
                target.constructor,
            ) ?? []
        existingHandlers.push({
            predicate,
            handler: descriptor.value,
            methodName: key,
        })

        Reflect.defineMetadata(
            EventBaseTypes.FILE_UPLOADED,
            existingHandlers,
            target,
            key,
        )

        EventRegistry.add(EventBaseTypes.FILE_UPLOADED)
    }
}
