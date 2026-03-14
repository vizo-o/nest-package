import { Injectable } from '@nestjs/common'
import { Controller, Delete, Get, Post, Put } from './decorators'
import type { CognitoTriggerEvent } from './entities'
import type { UserDaoBase } from './user.dao'

@Controller('user')
@Injectable()
export abstract class UserServiceBase {
    abstract readonly dao: UserDaoBase

    constructor() {}

    async getUserAuthorizationData(
        email: string,
        resource: string,
        action: string,
    ): Promise<{ actionIsPermitted: boolean; userRoles: string[] }> {
        const { permissions, userRoles } =
            await this.dao.getUserAuthorizationData(email)

        const actionIsPermitted = permissions.some(
            (permission: { resource: string; action: string }) =>
                (permission.resource === resource ||
                    permission.resource === 'any') &&
                (permission.action === action || permission.action === 'any'),
        )

        return {
            actionIsPermitted,
            userRoles,
        }
    }

    async checkUserAllowedToSignup(
        event: CognitoTriggerEvent,
    ): Promise<CognitoTriggerEvent> {
        const { email } = event.request.userAttributes

        const isAllowedToSignUp = await this.dao.checkUserAllowedToSignup(email)

        if (!isAllowedToSignUp) {
            throw new Error(
                `User ${email} is not allowed to signup, please contact an administrator`,
            )
        }

        return event
    }

    @Get({
        route: '/get/:id',
        permission: {
            resource: 'user',
            action: 'read',
        },
    })
    getUser({ id }: { id: string }) {
        return this.dao.getUser(id)
    }

    @Get({
        route: '/get-by-email/:email',
        permission: {
            resource: 'user',
            action: 'read',
        },
    })
    getUserByEmail({ email }: { email: string }) {
        return this.dao.getUserByEmail(email)
    }

    @Post({
        route: '/create',
        permission: {
            resource: 'user',
            action: 'create',
        },
    })
    create({ body }: { body: unknown }) {
        return this.dao.createUser(body)
    }

    @Put({
        route: '/update/:email',
        permission: {
            resource: 'user',
            action: 'update',
        },
    })
    update({ email, body }: { email: string; body: unknown }) {
        return this.dao.updateUser(email, body)
    }

    @Delete({
        route: '/delete/:id',
        permission: {
            resource: 'user',
            action: 'delete',
        },
    })
    delete({ id }: { id: string }) {
        return this.dao.deleteUser(id)
    }
}
