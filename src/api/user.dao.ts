import { Injectable } from '@nestjs/common'
import type { IApiPrismaService } from './entities'

@Injectable()
export abstract class UserDaoBase {
    abstract prisma: IApiPrismaService

    constructor() {}

    createUser(data: unknown) {
        return this.prisma.user.create({ data })
    }

    async checkUserAllowedToSignup(email: string) {
        try {
            const user = await this.prisma.user.findUnique({ where: { email } })

            return user !== null
        } catch (err) {
            console.error(`Error checking email allowed to signup: ${err}`)

            return false
        }
    }

    async getUserAuthorizationData(email: string) {
        const user = (await this.prisma.user.findUnique({
            where: { email },
            select: { roles: true },
        })) as { roles: string[] } | null
        if (!user) {
            throw new Error(`User not found: ${email}`)
        }
        const { roles } = user

        const permissions = (await this.prisma.permission.findMany({
            where: {
                role: {
                    in: roles,
                },
            },
            select: { resource: true, action: true },
        })) as { resource: string; action: string }[]

        return { permissions, userRoles: roles }
    }

    getUser(id: string) {
        return this.prisma.user.findUnique({ where: { id } })
    }

    getUserByEmail(email: string) {
        return this.prisma.user.findUnique({ where: { email } })
    }

    updateUser(email: string, data: unknown) {
        return this.prisma.user.update({ where: { email }, data })
    }

    deleteUser(id: string) {
        return this.prisma.user.delete({ where: { id } })
    }
}
