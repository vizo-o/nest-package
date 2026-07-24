process.env.APP_NAME = 'test-app'
process.env.ENV = 'test'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

import type { LoggerService } from '@nestjs/common'
import type { ModuleRef } from '@nestjs/core'
import type { Module } from '@nestjs/core/injector/module'
import type { S3Service } from '../../src/aws/services'
import type { EventDaoBase } from '../../src/event/event.dao'
import { EventServiceBase } from '../../src/event/event.service'
import { EventBaseTypes } from '../../src/event/entities'

class TestEventService extends EventServiceBase<{ type: string }> {
    readonly moduleRef: ModuleRef
    readonly module: Module
    readonly dao: EventDaoBase

    constructor(dao: EventDaoBase, s3: S3Service, logger?: LoggerService) {
        super(logger)
        this.moduleRef = {
            get: jest.fn(),
        } as unknown as ModuleRef
        this.module = {} as unknown as Module
        this.dao = dao
        this.s3 = s3
    }
}

describe('EventServiceBase file re-upload', () => {
    let service: TestEventService
    let createFileRecord: jest.Mock
    let getFileRecordFromKey: jest.Mock
    let updateFileRecord: jest.Mock
    let getMetadata: jest.Mock
    let fileHandler: jest.Mock

    beforeEach(() => {
        jest.clearAllMocks()

        createFileRecord = jest.fn()
        getFileRecordFromKey = jest.fn()
        updateFileRecord = jest.fn().mockResolvedValue({ id: 'frc-existing' })
        getMetadata = jest.fn().mockResolvedValue({ Metadata: {} })
        fileHandler = jest.fn().mockResolvedValue({ fileStatus: 'processed' })

        const dao = {
            createEventLog: jest.fn().mockResolvedValue({ id: 'log-1' }),
            createFileRecord,
            getFileRecordFromKey,
            updateFileRecord,
        } as unknown as EventDaoBase

        const s3 = {
            getMetadata,
        } as unknown as S3Service

        service = new TestEventService(dao, s3)
        service.fileHandlerSubscriptions = [
            {
                predicate: (key: string) => key.startsWith('machine-id/'),
                handler: fileHandler,
            },
        ]
    })

    const uploadedEvent = {
        type: EventBaseTypes.FILE_UPLOADED,
        s3: {
            object: {
                key: 'machine-id/manifest.json',
                eTag: 'etag-2',
            },
            bucket: {
                name: 'md-portal-bucket',
            },
        },
    }

    it('reuses existing fileRecord on unique key conflict and reprocesses', async () => {
        const uniqueError = Object.assign(new Error('Unique constraint'), {
            code: 'P2002',
        })
        createFileRecord.mockRejectedValueOnce(uniqueError)
        getFileRecordFromKey.mockResolvedValue({
            id: 'frc-existing',
            status: 'error',
        })

        const result = await service.handleEvent(uploadedEvent)

        expect(getFileRecordFromKey).toHaveBeenCalledWith(
            'machine-id/manifest.json',
        )
        expect(updateFileRecord).toHaveBeenCalledWith('frc-existing', {
            status: 'pending',
            error: null,
            eTag: 'etag-2',
            bucket: 'md-portal-bucket',
        })
        expect(fileHandler).toHaveBeenCalledWith({
            key: 'machine-id/manifest.json',
            bucket: 'md-portal-bucket',
            fileRecordId: 'frc-existing',
        })
        expect(updateFileRecord).toHaveBeenCalledWith('frc-existing', {
            status: 'processed',
        })
        expect(result).toEqual([{ fileStatus: 'processed' }])
    })

    it('creates a new fileRecord when key is new', async () => {
        createFileRecord.mockResolvedValue({ id: 'frc-new' })

        const result = await service.handleEvent(uploadedEvent)

        expect(createFileRecord).toHaveBeenCalledWith({
            key: 'machine-id/manifest.json',
            eTag: 'etag-2',
            bucket: 'md-portal-bucket',
            status: 'pending',
        })
        expect(getFileRecordFromKey).not.toHaveBeenCalled()
        expect(fileHandler).toHaveBeenCalledWith({
            key: 'machine-id/manifest.json',
            bucket: 'md-portal-bucket',
            fileRecordId: 'frc-new',
        })
        expect(result).toEqual([{ fileStatus: 'processed' }])
    })
})
