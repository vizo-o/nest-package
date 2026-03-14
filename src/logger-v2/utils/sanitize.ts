/**
 * Employee roles that indicate internal users
 */
const EMPLOYEE_ROLES = [
    'admin',
    'vizoIntaker',
    'vizoBranch',
    'salesAdmin',
    'employee',
    'supervisor',
    'doctor',
    'formsAdmin',
    'intakeSpecialist',
    'nurse',
    'md',
    'incident_manager',
    'viewer',
]

/**
 * Customer PII fields that should be redacted
 */
const CUSTOMER_PII_FIELDS = [
    'email',
    'phone',
    'firstName',
    'lastName',
    'address',
    'city',
    'postalCode',
    'country',
    'dateOfBirth',
    'ssn',
    'creditCard',
    'cvv',
    'pin',
    'phoneNumber',
    'mobile',
    'homePhone',
    'workPhone',
]

/**
 * Fields to always preserve (IDs and non-PII metadata)
 */
const PRESERVED_FIELDS = [
    'vizoId',
    'id',
    'customerExternalId',
    'euId',
    'temporaryId',
    'saleStatus',
    'processManager',
    'isVip',
    'researchGroup',
    'requestId',
    'eventLogId',
    'actionId',
    'endpoint',
    'service',
    'errorType',
    'statusCode',
    'scheduledJob',
    'eventKey',
    'cron',
]

/**
 * Sensitive keys that should always be redacted
 */
const SENSITIVE_KEYS = [
    'password',
    'token',
    'secret',
    'authorization',
    'cookie',
    'apiKey',
    'apikey',
    'accessToken',
    'refreshToken',
    'authToken',
    'bearer',
    'credentials',
    'privateKey',
    'private_key',
    'ssn',
    'socialSecurityNumber',
    'creditCard',
    'credit_card',
    'cvv',
    'pin',
]

/**
 * Determines if a user is an employee based on email domain or roles
 *
 * @param email - User email address to check
 * @param userRoles - Optional array of user roles (only used if email domain check fails)
 * @returns true if user is an employee
 */
export function isEmployeeUser(email?: string, userRoles?: string[]): boolean {
    if (!email) {
        return false
    }

    // Check email domain first - this is the primary indicator
    if (email.endsWith('@vizo-o.com')) {
        return true
    }

    // If email domain doesn't match, check roles as fallback
    // This handles cases where we know the user is an employee via roles
    // but the email might not be @vizo-o.com (e.g., test accounts)
    if (userRoles && userRoles.length > 0) {
        return userRoles.some((role) => EMPLOYEE_ROLES.includes(role))
    }

    return false
}

/**
 * Partially redacts a phone number, keeping last 4 digits
 *
 * @param phone - Phone number string
 * @returns Redacted phone number or [REDACTED]
 */
function redactPhoneNumber(phone: string): string {
    if (!phone || typeof phone !== 'string') {
        return '[REDACTED]'
    }

    // Extract digits only
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 4) {
        return '[REDACTED]'
    }

    // Keep last 4 digits
    const lastFour = digits.slice(-4)

    return `***-***-${lastFour}`
}

/**
 * Partially redacts an email address
 *
 * @param email - Email address
 * @returns Redacted email (e.g., c****@example.com)
 */
function redactEmail(email: string): string {
    if (!email || typeof email !== 'string') {
        return '[REDACTED]'
    }

    const [localPart, domain] = email.split('@')
    if (!localPart || !domain) {
        return '[REDACTED]'
    }

    if (localPart.length <= 1) {
        return `*@${domain}`
    }

    const firstChar = localPart[0]
    const rest = '*'.repeat(Math.min(localPart.length - 1, 4))

    return `${firstChar}${rest}@${domain}`
}

/**
 * Sanitizes a customer object, preserving IDs and non-PII fields while redacting PII
 *
 * @param obj - Customer object to sanitize
 * @param userEmail - Optional user email for employee detection
 * @param userRoles - Optional user roles for employee detection
 * @returns Sanitized customer object
 */
function sanitizeCustomerObject(
    obj: Record<string, unknown>,
    userEmail?: string,
    userRoles?: string[],
): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase()

        // Always preserve IDs and non-PII metadata
        if (PRESERVED_FIELDS.includes(key)) {
            sanitized[key] = value
            continue
        }

        // Redact PII fields (check if key matches any PII field, case-insensitive)
        const isPIIField = CUSTOMER_PII_FIELDS.some(
            (piiField) => lowerKey === piiField.toLowerCase(),
        )

        if (isPIIField) {
            if (lowerKey === 'email' && typeof value === 'string') {
                // Preserve employee emails, redact customer emails
                if (isEmployeeUser(value, userRoles)) {
                    sanitized[key] = value
                } else {
                    sanitized[key] = redactEmail(value)
                }
            } else if (
                (lowerKey === 'phone' ||
                    lowerKey === 'phonenumber' ||
                    lowerKey === 'mobile' ||
                    lowerKey === 'homephone' ||
                    lowerKey === 'workphone') &&
                typeof value === 'string'
            ) {
                sanitized[key] = redactPhoneNumber(value)
            } else {
                sanitized[key] = '[REDACTED]'
            }
            continue
        }

        // Recursively sanitize nested objects
        if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)
        ) {
            sanitized[key] = sanitizeCustomerObject(
                value as Record<string, unknown>,
                userEmail,
                userRoles,
            )
            continue
        }

        // Recursively sanitize arrays
        if (Array.isArray(value)) {
            sanitized[key] = value.map((item) => {
                if (
                    typeof item === 'object' &&
                    item !== null &&
                    !Array.isArray(item)
                ) {
                    return sanitizeCustomerObject(
                        item as Record<string, unknown>,
                        userEmail,
                        userRoles,
                    )
                }

                return item
            })
            continue
        }

        // Preserve other fields
        sanitized[key] = value
    }

    return sanitized
}

/**
 * Sanitizes a JSON string by parsing, sanitizing recursively, and re-stringifying
 *
 * @param jsonString - JSON string to sanitize
 * @param userEmail - Optional user email for employee detection
 * @param userRoles - Optional user roles for employee detection
 * @returns Sanitized JSON string or original string if parsing fails
 */
export function sanitizeJsonString(
    jsonString: string,
    userEmail?: string,
    userRoles?: string[],
): string {
    if (!jsonString || typeof jsonString !== 'string') {
        return jsonString
    }

    try {
        const parsed = JSON.parse(jsonString)
        const sanitized = sanitizeContext(parsed, userEmail, userRoles)

        return JSON.stringify(sanitized, null, 2)
    } catch {
        // If parsing fails, return original string
        // This handles cases where the string isn't valid JSON
        return jsonString
    }
}

/**
 * Sanitizes sensitive data from log context
 * Removes or redacts passwords, tokens, PII, and authorization headers
 *
 * @param context - Context object to sanitize
 * @param userEmail - Optional user email for employee detection
 * @param userRoles - Optional user roles for employee detection
 * @returns Sanitized context object
 */
export function sanitizeContext(
    context: Record<string, unknown>,
    userEmail?: string,
    userRoles?: string[],
): Record<string, unknown> {
    if (!context || typeof context !== 'object') {
        return {}
    }

    const sanitized = { ...context }

    Object.keys(sanitized).forEach((key) => {
        const lowerKey = key.toLowerCase()
        const value = sanitized[key]

        // Check if this is a sensitive key that should always be redacted
        const shouldSanitize =
            SENSITIVE_KEYS.some((sensitive) =>
                lowerKey.includes(sensitive.toLowerCase()),
            ) ||
            lowerKey.includes('password') ||
            lowerKey.includes('token') ||
            lowerKey.includes('secret') ||
            lowerKey === 'ssn' ||
            lowerKey === 'socialsecuritynumber' ||
            lowerKey === 'creditcard' ||
            lowerKey === 'privatekey'

        if (shouldSanitize) {
            sanitized[key] = '[REDACTED]'
        } else if (lowerKey === 'email' && typeof value === 'string') {
            // Conditional email sanitization: preserve employee emails, redact customer emails
            // Only apply to top-level emails (not in customer objects, which are handled separately)
            // Check the email value itself, not the userEmail parameter
            if (isEmployeeUser(value)) {
                sanitized[key] = value
            } else {
                sanitized[key] = redactEmail(value)
            }
        } else if (
            (lowerKey === 'phone' ||
                lowerKey === 'phonenumber' ||
                lowerKey === 'mobile' ||
                lowerKey === 'homephone' ||
                lowerKey === 'workphone') &&
            typeof value === 'string'
        ) {
            // Partial phone number redaction
            sanitized[key] = redactPhoneNumber(value)
        } else if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)
        ) {
            // Check if this looks like a customer object
            const obj = value as Record<string, unknown>
            const hasVizoId =
                'vizoId' in obj ||
                'customerExternalId' in obj ||
                'euId' in obj ||
                'temporaryId' in obj
            const hasPII =
                'email' in obj ||
                'phone' in obj ||
                'firstName' in obj ||
                'lastName' in obj ||
                'phoneNumber' in obj ||
                'mobile' in obj

            if (hasVizoId && hasPII) {
                // This looks like a customer object - apply selective sanitization
                sanitized[key] = sanitizeCustomerObject(
                    obj,
                    userEmail,
                    userRoles,
                )
            } else {
                // Recursively sanitize nested objects
                sanitized[key] = sanitizeContext(obj, userEmail, userRoles)
            }
        } else if (Array.isArray(value)) {
            // Handle arrays
            sanitized[key] = value.map((item) => {
                if (
                    typeof item === 'object' &&
                    item !== null &&
                    !Array.isArray(item)
                ) {
                    const obj = item as Record<string, unknown>
                    const hasVizoId =
                        'vizoId' in obj || 'customerExternalId' in obj
                    const hasPII =
                        'email' in obj ||
                        'phone' in obj ||
                        'firstName' in obj ||
                        'lastName' in obj

                    if (hasVizoId && hasPII) {
                        return sanitizeCustomerObject(obj, userEmail, userRoles)
                    }

                    return sanitizeContext(obj, userEmail, userRoles)
                }

                return item
            })
        }
    })

    return sanitized
}
