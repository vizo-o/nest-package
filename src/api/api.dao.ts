import { Injectable } from '@nestjs/common'
import type { IApiPrismaService } from './entities'

@Injectable()
export abstract class ApiDaoBase {
    abstract prisma: IApiPrismaService
    constructor() {}

    createAccessLog(data: unknown) {
        return this.prisma.accessLog.create({
            data,
        }) as Promise<{ id: string }>
    }
}
