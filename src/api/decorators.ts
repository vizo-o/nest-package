import 'reflect-metadata'
import type { ExtractRouteParams, RouteMetadata } from './entities'
import { HttpMethod } from './entities'

type ConcreteClassConstructor<T = unknown> = new (...args: never[]) => T
// Using any here because abstract class constructors with generic types require
// flexible argument types that can't be easily constrained without breaking
// the decorator pattern for both concrete and abstract classes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AbstractClassConstructor<T = any> = abstract new (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) => T
// Using any here for the generic default to support both concrete and abstract
// class constructors in decorator patterns where the exact type isn't known
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClassConstructor<T = any> =
    | ConcreteClassConstructor<T>
    | AbstractClassConstructor<T>

export const CONTROLLER_KEY = Symbol('Controller')
export const ROUTE_KEY = Symbol('Route')

const registeredControllers = new Set<string>()

const isRouteCreateDataWithPermission = (
    routeCreateData: unknown,
): routeCreateData is {
    route: string
    permission: { resource: string; action: string }
} => {
    return (
        typeof routeCreateData === 'object' &&
        routeCreateData !== null &&
        'route' in routeCreateData &&
        'permission' in routeCreateData
    )
}

export function Controller(controllerName: string) {
    return function (constructor: ClassConstructor) {
        if (registeredControllers.has(controllerName)) {
            throw new Error(
                `Duplicate controller registration: ${controllerName}`,
            )
        }

        registeredControllers.add(controllerName)
        Reflect.defineMetadata(
            CONTROLLER_KEY,
            controllerName,
            constructor.prototype,
        )
    }
}

function createRouteDecorator<Method extends HttpMethod>(httpMethod: Method) {
    return function <Route extends string>(
        routeCreateData: { route: Route } & (
            | {
                  permissionGenerator: (
                      params: ExtractRouteParams<
                          Route,
                          Method extends 'POST' | 'PUT' | 'PATCH' ? true : false
                      >,
                  ) => { resource: string; action: string }
              }
            | {
                  permission: { resource: string; action: string }
              }
        ),
    ) {
        return function (
            target: object,
            key: string | symbol,
            descriptor: TypedPropertyDescriptor<
                (
                    params: ExtractRouteParams<
                        Route,
                        Method extends 'POST' | 'PUT' | 'PATCH' ? true : false
                    >,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ) => any
            >,
        ) {
            if (typeof descriptor.value !== 'function') {
                throw new Error('Invalid route method')
            }

            // would be nice to avoid these ignores, the issue is that the type of
            // descriptor.value is not inferred by the RouteMetadata type, which expects
            // <T extends (params: unknown> and here we have a more specific type as
            // we already know the decorated method parameter types
            //

            // @ts-ignore
            // prettier-ignore
            const routes: RouteMetadata<typeof descriptor.value>[] =  Reflect.getMetadata(ROUTE_KEY, target.constructor.prototype) as RouteMetadata<typeof descriptor.value>[] || []

            const permissionGenerator = isRouteCreateDataWithPermission(
                routeCreateData,
            )
                ? () => routeCreateData.permission
                : routeCreateData.permissionGenerator

            if (descriptor.value) {
                routes.push({
                    path: routeCreateData.route,
                    httpMethod,
                    method: descriptor.value,
                    permissionGenerator,
                })

                Reflect.defineMetadata(
                    ROUTE_KEY,
                    routes,
                    target.constructor.prototype,
                )
            }

            return descriptor
        }
    }
}

export const Get = createRouteDecorator(HttpMethod.GET)
export const Post = createRouteDecorator(HttpMethod.POST)
export const Put = createRouteDecorator(HttpMethod.PUT)
export const Patch = createRouteDecorator(HttpMethod.PATCH)
export const Delete = createRouteDecorator(HttpMethod.DELETE)
