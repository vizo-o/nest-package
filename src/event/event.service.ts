import type { LoggerService, OnModuleInit } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { ModuleRef } from '@nestjs/core'
import type { Module } from '@nestjs/core/injector/module'
import type { SQSEvent } from 'aws-lambda'
import { reportError, type ErrorContext } from '../aws/report-error'
import type { LambdaService, S3Service } from '../aws/services.js'
import type {
    EventResponse,
    FileEventPayload,
    FileEventResponse,
    FileUploadedEvent,
} from './entities'
import {
    EventBaseTypes,
    createScheduleEventKey,
    isFileUploadedEvent,
    isObjectCreatedEvent,
    isS3TestEvent,
    isSQSEvent,
    isScheduleEvent,
    isSnsEvent,
} from './entities'
import type { EventDaoBase } from './event.dao'
import {
    EVENT_HANDLER_METADATA_KEY,
    EventRegistry,
    SCHEDULE_HANDLER_ENABLED_ENVS_METADATA_KEY,
    isHandlerEnabledForEnv,
    isScheduleEnabledForEnv,
} from './event.decorator'

/**
 * Simple logger interface for EventServiceBase
 * Compatible with both old VizoLoggerService and new LoggerService
 */
interface EventLogger {
    log(message: string, context?: string): void
    error(message: string, trace?: string, context?: string): void
    warn(message: string, context?: string): void
}

@Injectable()
export abstract class EventServiceBase<
    Event extends { type: string },
> implements OnModuleInit {
    eventSubscriptions: {
        [event: string]: Array<(event: Event) => Promise<EventResponse>>
    } = {}
    fileHandlerSubscriptions: Array<{
        handler: (payload: FileEventPayload) => Promise<FileEventResponse>
        predicate: (key: string) => boolean
    }> = []
    abstract moduleRef: ModuleRef
    abstract module: Module
    abstract dao: EventDaoBase
    lambda?: LambdaService
    s3?: S3Service
    protected logger?: EventLogger

    constructor(logger?: LoggerService) {
        this.logger = logger as unknown as EventLogger
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
                this.logger.log(message, context || 'EventService')
            } else if (level === 'error') {
                this.logger.error(message, undefined, context || 'EventService')
            } else {
                this.logger.warn(message, context || 'EventService')
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

    onModuleInit() {
        const importedModules = this.getImportedModules(this.module)

        for (const importedModule of importedModules || []) {
            const exportedServices =
                this.getExportedServicesForModule(importedModule)

            for (const service of exportedServices) {
                this.initializeHandlersForService(service)
            }
        }
    }

    private getImportedModules(module: Module): Array<Module> | undefined {
        const imports = Reflect.getMetadata('imports', module)
        if (!imports) {
            return undefined
        }

        return Array.isArray(imports) ? (imports as Module[]) : undefined
    }

    private getExportedServicesForModule(
        importedModule: Module,
    ): Array<typeof Object> {
        const exportedItems = Reflect.getMetadata(
            'exports',
            importedModule as object,
        ) as Array<typeof Object>

        return (
            exportedItems?.filter((item) =>
                Reflect.getMetadata(EVENT_HANDLER_METADATA_KEY, item),
            ) || []
        )
    }

    private initializeHandlersForService(service: typeof Object) {
        const serviceInstance = this.moduleRef.get(service, { strict: false })
        if (!serviceInstance) {
            return
        }

        const prototype = Object.getPrototypeOf(serviceInstance)
        for (const methodName of Object.getOwnPropertyNames(prototype)) {
            if (
                methodName !== 'constructor' &&
                typeof prototype[methodName] === 'function'
            ) {
                this.bindMethodToEvent(serviceInstance, prototype, methodName)
            }
        }
    }

    private bindMethodToEvent(
        serviceInstance: object,
        prototype: object,
        methodName: string,
    ) {
        for (const eventType of EventRegistry) {
            if (eventType !== EventBaseTypes.FILE_UPLOADED) {
                const eventHandlers = Reflect.getMetadata(
                    eventType,
                    prototype,
                    methodName,
                ) as Array<(event: Event) => Promise<EventResponse>>
                const scheduleHandlerEnabledEnvs = eventType.startsWith(
                    'schedule',
                )
                    ? (Reflect.getMetadata(
                          SCHEDULE_HANDLER_ENABLED_ENVS_METADATA_KEY,
                          prototype,
                          methodName,
                      ) as Array<string[] | undefined> | undefined)
                    : undefined

                if (eventHandlers) {
                    eventHandlers.forEach((eventHandler, handlerIndex) => {
                        if (typeof eventHandler !== 'function') {
                            throw new Error('Event handler must be a function')
                        }

                        if (
                            eventType.startsWith('schedule') &&
                            !isHandlerEnabledForEnv(
                                scheduleHandlerEnabledEnvs?.[handlerIndex],
                            )
                        ) {
                            return
                        }

                        if (!this.eventSubscriptions[eventType]) {
                            this.eventSubscriptions[eventType] = []
                        }
                        this.eventSubscriptions[eventType].push(
                            eventHandler.bind(serviceInstance),
                        )
                    })
                }
            }
            if (eventType === EventBaseTypes.FILE_UPLOADED) {
                const fileEventHandlers = Reflect.getMetadata(
                    eventType,
                    prototype,
                    methodName,
                ) as Array<{
                    predicate: (key: string) => boolean
                    handler: () => Promise<FileEventResponse>
                }>
                if (fileEventHandlers) {
                    fileEventHandlers.forEach((eventHandler) => {
                        if (typeof eventHandler.handler !== 'function') {
                            throw new Error('File handler must be a function')
                        }
                        this.fileHandlerSubscriptions.push({
                            handler: eventHandler.handler.bind(serviceInstance),
                            predicate: eventHandler.predicate,
                        })
                    })
                }
            }
        }
    }

    getScheduleCrons() {
        return Array.from(EventRegistry).filter(
            (key) => key.startsWith('schedule') && isScheduleEnabledForEnv(key),
        )
    }

    async handleEvent(
        event: unknown,
    ): Promise<(EventResponse | FileEventResponse)[]> {
        const eventLog = await this.dao.createEventLog(event)
        this.logMessage('log', `Handling event ${eventLog.id}`)

        // Check for S3 test events before preprocessing (they have special handling)
        if (isS3TestEvent(event)) {
            this.logMessage('log', 'S3 test event received')

            return [{ statusCode: 200, message: 'S3 test event received' }]
        }

        const processedEvent = this.preProcessEvent(event)

        const eventKey = isScheduleEvent(event)
            ? createScheduleEventKey(event.cron)
            : processedEvent.type

        if (isFileUploadedEvent(processedEvent)) {
            return this.handleFileUploadedEvent(processedEvent)
        }

        const eventSubscriptions = this.eventSubscriptions[eventKey]

        if (!eventSubscriptions) {
            const error = new Error(
                `No subscriptions for event ${eventKey}, event log id: ${eventLog.id}`,
            )
            const errorContext: ErrorContext = {
                category: 'infrastructure',
                severity: 'high',
                title: `No subscriptions for event: ${eventKey}`,
                description: `Event handler not found for event type "${eventKey}". Event log id: ${eventLog.id}`,
                fingerprint: `no-subscriptions-for-event-${eventKey}`,
                metadata: {
                    eventKey,
                    eventLogId: eventLog.id,
                },
            }
            await reportError(error, errorContext)

            // Return error response instead of throwing to avoid duplicate error reporting
            // The error has already been reported to admin system with proper fingerprint
            return [
                {
                    statusCode: 500,
                    message: `No subscriptions for event ${eventKey}`,
                    error: error.message,
                },
            ]
        }

        const results = await Promise.all(
            eventSubscriptions.map((eventHandler) =>
                eventHandler(processedEvent),
            ),
        )

        return results
    }

    private async handleFileUploadedEvent(
        event: Event & FileUploadedEvent,
    ): Promise<Array<FileEventResponse>> {
        if (!this.s3) {
            throw new Error('Event service error - S3Service not found')
        }

        const {
            object: { key, eTag },
            bucket: { name: bucket },
        } = event.s3

        // This metadata is placed by the s3 service when a file is uploaded to a bucket.
        // By checking for it here and ignoring the file we ensure that no additional event
        // handlers are triggered for the file, and prevent a possible cloud overflow.
        const metadataResponse = await this.s3.getMetadata({
            key,
            bucket,
        })

        const lambdaIgnoreMetadata =
            metadataResponse.Metadata?.['lambda-ignore']
        if (lambdaIgnoreMetadata === 'true') {
            try {
                await this.dao.createFileRecord({
                    key,
                    eTag,
                    bucket,
                    status: 'ignored',
                })
            } catch (error) {
                if (isPrismaUniqueConstraintError(error)) {
                    const fileRecord = await this.dao.getFileRecordFromKey(key)

                    return [{ fileStatus: fileRecord?.status ?? 'ignored' }]
                }
                throw error
            }

            return [{ fileStatus: 'ignored' }]
        }

        const fileRecord = await this.createOrReusePendingFileRecord({
            key,
            eTag,
            bucket,
        })

        const fileHandlers = this.fileHandlerSubscriptions
        if (fileHandlers) {
            const predicateFileHandlers = fileHandlers.filter(({ predicate }) =>
                predicate(event.s3.object.key),
            )
            if (predicateFileHandlers && predicateFileHandlers.length > 0) {
                const payload = {
                    key,
                    bucket,
                    fileRecordId: fileRecord.id,
                }
                try {
                    const output = await Promise.all(
                        predicateFileHandlers.map(async ({ handler }) => {
                            return await handler(payload)
                        }),
                    )

                    if (
                        output.some(({ fileStatus }) => fileStatus === 'error')
                    ) {
                        const errors = output
                            .filter(({ fileStatus }) => fileStatus === 'error')
                            .map(({ error }) => error)
                            .join(', ')
                        await this.dao.updateFileRecord(fileRecord.id, {
                            status: 'error',
                            error: errors || 'Unknown error',
                        })
                        throw new Error(errors)
                    } else {
                        const firstStatus = output[0].fileStatus
                        if (
                            output.every(
                                ({ fileStatus }) => fileStatus === firstStatus,
                            )
                        ) {
                            await this.dao.updateFileRecord(fileRecord.id, {
                                status: firstStatus,
                            })
                        } else {
                            const error = `Inconsistent file status: ${output
                                .map(({ fileStatus }) => fileStatus)
                                .join(', ')}`
                            await this.dao.updateFileRecord(fileRecord.id, {
                                status: 'error',
                                error,
                            })
                            throw new Error(error)
                        }

                        return output
                    }
                } catch (error) {
                    await this.dao.updateFileRecord(fileRecord.id, {
                        status: 'error',
                        error: JSON.stringify(error),
                    })

                    throw error
                }
            }
        }

        await this.dao.updateFileRecord(fileRecord.id, {
            status: 'error',
            error: `No file handlers for key ${event.s3.object.key}`,
        })

        throw new Error(`No file handlers for key ${event.s3.object.key}`)
    }

    private async createOrReusePendingFileRecord(input: {
        key: string
        eTag: string
        bucket: string
    }): Promise<{ id: string }> {
        try {
            return await this.dao.createFileRecord({
                key: input.key,
                eTag: input.eTag,
                bucket: input.bucket,
                status: 'pending',
            })
        } catch (error) {
            if (!isPrismaUniqueConstraintError(error)) {
                throw error
            }

            const existing = await this.dao.getFileRecordFromKey(input.key)
            if (!existing) {
                throw error
            }

            // Same S3 key re-uploaded (e.g. CI overwrite). Reset and reprocess.
            await this.dao.updateFileRecord(existing.id, {
                status: 'pending',
                error: null,
                eTag: input.eTag,
                bucket: input.bucket,
            })

            return existing
        }
    }

    protected preProcessEvent(event: unknown) {
        // unwrap SQS event
        if (isSQSEvent(event)) {
            const sqsEvent = event as SQSEvent
            const queueArn = sqsEvent.Records[0]?.eventSourceARN || ''
            const unwrappedEvent = JSON.parse(sqsEvent.Records[0].body)
            // unwrap S3 event
            if (unwrappedEvent?.Records) {
                event = unwrappedEvent.Records[0]
            } else {
                // If unwrapped event already has a type field, use it as-is
                // This allows SQS messages to specify their event type directly
                event = unwrappedEvent

                // If event doesn't have a type, try to infer from queue ARN
                // This handles cases where messages are sent without explicit type (e.g., notification queues)
                if (!(event as Event).type && queueArn) {
                    // Extract queue name from ARN (format: arn:aws:sqs:region:account:queue-name)
                    const queueNameMatch = queueArn.match(/:([^:]+)$/)
                    if (queueNameMatch) {
                        const queueName = queueNameMatch[1].toLowerCase()
                        // Try to infer event type from queue name patterns
                        // This is a generic fallback - services can override preProcessEvent for specific routing
                        if (queueName.includes('notification')) {
                            // For notification queues, add type based on queue name pattern
                            // Services should send messages with explicit type, but this provides fallback
                            event = {
                                ...unwrappedEvent,
                                type: 'NOTIFICATION_QUEUE',
                            } as Event
                        } else if (queueName.includes('lifecycle')) {
                            event = {
                                ...unwrappedEvent,
                                type: 'LIFECYCLE_QUEUE',
                            } as Event
                        }
                    }
                }
            }
        }

        if (isObjectCreatedEvent(event)) {
            // Object key may have spaces or unicode non-ASCII characters.
            event.s3.object.key = decodeURIComponent(
                event.s3.object.key.replace(/\+/g, ' '),
            )

            return {
                ...event,
                type: EventBaseTypes.FILE_UPLOADED,
            } as unknown as Event
        }

        if (isSnsEvent(event)) {
            const { originationNumber, messageBody: message } = JSON.parse(
                event.Records[0].Sns.Message,
            )

            return {
                type: EventBaseTypes.SMS_RECEIVED,
                originationNumber,
                message,
            } as unknown as Event
        }

        if (!(event as Event).type) {
            throw new Error(
                `Event type could not be determined for event: ${JSON.stringify(
                    event,
                )}`,
            )
        }

        return event as Event
    }
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: unknown }).code === 'P2002'
    )
}
