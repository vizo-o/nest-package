type PrimitiveParamType = string | number | boolean | Date | null
type ParamType = PrimitiveParamType | PrimitiveParamType[]

export const getPrismaOptions = <options>({ shouldEmitQueryEvents = false }) =>
    ({
        ...(shouldEmitQueryEvents && {
            log: [
                {
                    emit: 'event',
                    level: 'query',
                },
            ],
        }),
    }) as options

type PrismaClientWithQueryEvent = {
    $on(
        eventType: 'query',
        callback: (e: { query: string; params: string }) => void,
    ): void
}

export const configurePrismaClient = ({
    shouldEmitQueryEvents,
    prisma,
}: {
    shouldEmitQueryEvents: boolean
    prisma: PrismaClientWithQueryEvent
}) => {
    if (shouldEmitQueryEvents) {
        prisma.$on('query', (queryEvent) => {
            let queryWithParamsApplied = queryEvent.query
            let params: ParamType[] = []
            try {
                params = JSON.parse(queryEvent.params)
            } catch {
                console.log(
                    `Log DB query failed to parse params: ${queryEvent.params}`,
                )

                return
            }
            params.forEach((param: ParamType, index: number) => {
                const placeholder = `$${index + 1}`
                let paramAsString

                if (typeof param === 'string') {
                    paramAsString = `'${param}'` // Wrap strings in single quotes
                } else if (param instanceof Date) {
                    paramAsString = `'${param.toISOString()}'` // Convert dates to ISO strings and wrap in single quotes
                } else if (param === null) {
                    paramAsString = 'NULL' // Convert null to SQL NULL
                } else if (typeof param === 'boolean') {
                    paramAsString = param ? 'TRUE' : 'FALSE' // Convert boolean to SQL TRUE or FALSE
                } else if (Array.isArray(param)) {
                    paramAsString = `ARRAY[${param
                        .map((element) =>
                            typeof element === 'string'
                                ? `'${element}'`
                                : element,
                        )
                        .join(', ')}]` // Handle array of elements, assuming elements are not objects
                } else {
                    paramAsString = param.toString() // Convert all other types to string
                }

                queryWithParamsApplied = queryWithParamsApplied.replace(
                    placeholder,
                    paramAsString,
                )
            })
            console.log(queryWithParamsApplied)
        })
    }
}
