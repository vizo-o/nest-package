import type { S3EventRecord, SNSEvent, SQSEvent } from 'aws-lambda'

export const isObjectCreatedEvent = (
    event: unknown,
): event is S3EventRecord => {
    return (
        (event as S3EventRecord).eventSource === 'aws:s3' &&
        ((event as S3EventRecord).eventName === 'ObjectCreated:Put' ||
            (event as S3EventRecord).eventName ===
                'ObjectCreated:CompleteMultipartUpload')
    )
}

export const isSQSEvent = (event: unknown): event is SQSEvent => {
    return (
        (event as SQSEvent).Records &&
        (event as SQSEvent).Records[0].eventSource === 'aws:sqs'
    )
}

export const isSnsEvent = (event: unknown): event is SNSEvent => {
    return (
        (event as SNSEvent).Records &&
        (event as SNSEvent).Records[0].EventSource === 'aws:sns'
    )
}

export const isScheduleEvent = (event: unknown): event is ScheduleEvent => {
    return (event as ScheduleEvent).type === EventBaseTypes.SCHEDULE
}

type S3TestEvent = {
    event: {
        Records: {
            body: string
        }[]
    }
}

export const isS3TestEvent = (event: unknown): event is S3TestEvent => {
    if ((event as S3TestEvent).event?.Records?.[0]?.body) {
        try {
            const parsedEvent = JSON.parse(
                (event as S3TestEvent).event.Records[0].body,
            )
            if (
                parsedEvent.Service === 'Amazon S3' &&
                parsedEvent.Event === 's3:TestEvent'
            ) {
                return true
            }
        } catch {
            return false
        }
    }

    return false
}

export interface IEventPrismaService {
    log: {
        create: (event: unknown) => Promise<{ id: string }>
    }
    fileRecord: {
        create: (fileRecord: unknown) => Promise<{ id: string }>
        update: (fileRecord: unknown) => Promise<{ id: string }>
        findUnique: (input: {
            where: {
                key: string
            }
        }) => Promise<{ id: string; status: string }>
    }
}

export enum EventBaseTypes {
    SCHEDULE = 'SCHEDULE',
    FILE_UPLOADED = 'FILE_UPLOADED',
    SMS_RECEIVED = 'SMS_RECEIVED',
    DEBUG = 'DEBUG',
    SMOKE_TEST = 'SMOKE_TEST',
}

export type ScheduleEvent = {
    type: EventBaseTypes.SCHEDULE
    cron: string
}

export type DebugEvent = {
    type: EventBaseTypes.DEBUG
}

export type FileUploadedEvent = {
    type: EventBaseTypes.FILE_UPLOADED
} & S3EventRecord

export const isFileUploadedEvent = (
    event: unknown,
): event is FileUploadedEvent => {
    return (event as FileUploadedEvent).type === EventBaseTypes.FILE_UPLOADED
}

export type SmsEvent = {
    type: EventBaseTypes.SMS_RECEIVED
    receivedFromNumber: string
    message: string
}

export type SmokeTestEvent = {
    type: EventBaseTypes.SMOKE_TEST
    testId: string
    timestamp: string
    environment: string
}

export type EventBase =
    | ScheduleEvent
    | FileUploadedEvent
    | SmsEvent
    | DebugEvent
    | SmokeTestEvent

export interface EventResponse {
    statusCode: number
    message: string
    data?: Record<string, unknown>
    error?: string
}
export interface FileEventResponse {
    fileStatus: string
    error?: string
}

export const createScheduleEventKey = (cronString: string) =>
    `schedule ${cronString}` as const

export type FileEventPayload = {
    key: string
    bucket: string
    fileRecordId: string
}
