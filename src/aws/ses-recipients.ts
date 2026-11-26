/**
 * Outside prod, email may only reach test mailboxes. Every recipient that is
 * not allowlisted is replaced by a sink address, so a dev or staging run can
 * never email a real customer or staff member. Prod is left untouched.
 *
 * Only `ENV=prod` counts as prod; a missing or unknown ENV is treated as
 * non-prod (fail safe).
 */

/** Amazon SES mailbox simulator: accepts the message, delivers it to nobody. */
export const SES_SIMULATOR_SINK = 'success@simulator.amazonses.com'

/**
 * Test mailboxes that may receive non-prod mail. An entry that starts with
 * `@` allows a whole domain. Extend with `SES_NON_PROD_ALLOWED_RECIPIENTS`
 * (comma separated, same format).
 */
export const DEFAULT_NON_PROD_ALLOWED_RECIPIENTS = [
    'dev@vizo-o.com',
    'gilaade@vizo-o.com',
    '@simulator.amazonses.com',
]

export interface NonProdRouting {
    /** True only when ENV is exactly `prod`. */
    isProd: boolean
    /** Where the message goes. */
    recipients: string[]
    /** Original recipients that were replaced by the sink. */
    redirected: string[]
    /** The sink used for redirected recipients (non-prod only). */
    sink?: string
}

const normalize = (email: string): string => email.trim().toLowerCase()

/** `name+tag@domain` → `name@domain`, so plus aliases of a test mailbox pass. */
const withoutPlusTag = (email: string): string =>
    email.replace(/^([^+@]+)\+[^@]*@/, '$1@')

const allowedEntries = (env: NodeJS.ProcessEnv): string[] =>
    [
        ...DEFAULT_NON_PROD_ALLOWED_RECIPIENTS,
        ...(env.SES_NON_PROD_ALLOWED_RECIPIENTS ?? '').split(','),
    ]
        .map(normalize)
        .filter(Boolean)

export const isNonProdAllowedRecipient = (
    email: string,
    env: NodeJS.ProcessEnv = process.env,
): boolean => {
    const address = withoutPlusTag(normalize(email))
    const domain = address.slice(address.lastIndexOf('@'))

    return allowedEntries(env).some((entry) =>
        entry.startsWith('@')
            ? entry === domain
            : withoutPlusTag(entry) === address,
    )
}

/** `john.doe@example.com` → `j***@example.com`, for logs. */
export const maskEmail = (email: string): string => {
    const at = email.lastIndexOf('@')
    if (at <= 0) return '***'
    return `${email[0]}***${email.slice(at)}`
}

export const routeRecipientsForEnv = (
    recipients: string[],
    env: NodeJS.ProcessEnv = process.env,
): NonProdRouting => {
    if (env.ENV === 'prod') {
        return { isProd: true, recipients, redirected: [] }
    }

    const sink = normalize(env.SES_NON_PROD_SINK || SES_SIMULATOR_SINK)
    // The sink itself must be a test mailbox, or the guard means nothing.
    const safeSink = isNonProdAllowedRecipient(sink, env)
        ? sink
        : SES_SIMULATOR_SINK

    const kept: string[] = []
    const redirected: string[] = []
    for (const email of recipients) {
        if (isNonProdAllowedRecipient(email, env)) {
            kept.push(email)
        } else {
            redirected.push(email)
        }
    }

    const routed =
        redirected.length > 0 && !kept.some((e) => normalize(e) === safeSink)
            ? [...kept, safeSink]
            : kept

    return { isProd: false, recipients: routed, redirected, sink: safeSink }
}
