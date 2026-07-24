import { Injectable } from '@nestjs/common'
import type { IEventPrismaService } from './entities'

@Injectable()
export abstract class EventDaoBase {
    abstract prisma: IEventPrismaService
    constructor() {}

    createEventLog(event: unknown) {
        return this.prisma.log.create({
            data: {
                data: event,
            },
        })
    }

    createFileRecord(input: {
        key: string
        eTag: string
        bucket: string
        status: string
        error?: string
    }) {
        return this.prisma.fileRecord.create({
            data: input,
        })
    }

    getFileRecordFromKey(key: string) {
        return this.prisma.fileRecord.findUnique({
            where: {
                key,
            },
        })
    }

    updateFileRecord(
        id: string,
        {
            status,
            error,
            eTag,
            bucket,
        }: {
            status: string
            error?: string | null
            eTag?: string
            bucket?: string
        },
    ) {
        return this.prisma.fileRecord.update({
            where: {
                id,
            },
            data: {
                status,
                ...(error !== undefined && { error }),
                ...(eTag !== undefined && { eTag }),
                ...(bucket !== undefined && { bucket }),
            },
        })
    }
}
