import {
    GetSecretValueCommand,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'

const ssmClient = new SSMClient({})
const secretsManagerClient = new SecretsManagerClient({})

// Cache for Cognito client IDs to avoid hitting SSM/Secrets Manager on every request
let cognitoClientIdsCache: {
    current: string
    previous: string | null
    timestamp: number
} | null = null

// Cache TTL: 1 minute (60000 ms) - shorter to minimize overlap period issues
const CACHE_TTL_MS = 60 * 1000

/**
 * Parse secret metadata to extract client IDs
 */
function parseSecretMetadata(secretString: string): {
    current: string
    previous: string | null
    oldClientId?: string
    newClientId?: string
} {
    try {
        const parsed = JSON.parse(secretString)
        if (parsed && typeof parsed === 'object') {
            return {
                current: parsed.current || '',
                previous: parsed.previous || null,
                oldClientId: parsed.oldClientId,
                newClientId: parsed.newClientId,
            }
        }
    } catch {
        // Not JSON format
    }

    return {
        current: secretString,
        previous: null,
    }
}

/**
 * Get Cognito client IDs (current and previous) from secret metadata
 * Supports overlap period by returning both client IDs when available
 *
 * @param secretArn - ARN of the secret in Secrets Manager (optional, falls back to SSM if not provided)
 * @param parameterName - SSM parameter name as fallback (e.g., /admin-system/cognito/user-pool-client-id)
 * @returns Object with current and previous client IDs
 */
export async function getCognitoClientIds(
    secretArn: string | undefined,
    parameterName: string,
): Promise<{
    current: string
    previous: string | null
}> {
    const now = Date.now()

    // Return cached value if still valid
    if (
        cognitoClientIdsCache &&
        now - cognitoClientIdsCache.timestamp < CACHE_TTL_MS
    ) {
        return {
            current: cognitoClientIdsCache.current,
            previous: cognitoClientIdsCache.previous,
        }
    }

    if (secretArn) {
        try {
            // Try to get client IDs from secret metadata first (supports overlap period)
            const secretResponse = await secretsManagerClient.send(
                new GetSecretValueCommand({ SecretId: secretArn }),
            )

            if (secretResponse.SecretString) {
                const metadata = parseSecretMetadata(
                    secretResponse.SecretString,
                )

                // If secret has newClientId, use it as current (new format with rotation metadata)
                // If secret has oldClientId, use it as previous (new format with rotation metadata)
                // If secret only has 'current' field without newClientId, it's in old format
                // and we should fall back to SSM parameter which has the actual current client ID
                const hasNewFormat = !!metadata.newClientId

                if (hasNewFormat) {
                    const current = metadata.newClientId || metadata.current
                    const previous = metadata.oldClientId || metadata.previous

                    if (current) {
                        cognitoClientIdsCache = {
                            current,
                            previous: previous || null,
                            timestamp: now,
                        }

                        return {
                            current,
                            previous: previous || null,
                        }
                    }
                } else {
                    // Secret is in old format (only has 'current' which is the secret value, not client ID)
                    // Fall through to SSM parameter which has the actual client ID
                    console.warn(
                        'Secret is in old format (missing newClientId/oldClientId metadata). ' +
                            'Falling back to SSM parameter for client ID.',
                    )
                }
            }
        } catch (error) {
            console.warn(
                'Failed to get client IDs from secret, falling back to SSM:',
                error,
            )
            console.warn(
                'WARNING: Rotation overlap period support is DISABLED when using SSM fallback. ' +
                    'Only the current client ID will be accepted. Tokens from old client IDs may fail during rotation.',
            )
        }
    }

    // Fallback to SSM parameter if secret doesn't have metadata or secretArn not provided
    // NOTE: This fallback does NOT support rotation overlap period - only the current client ID is available
    // For proper rotation support, ensure COGNITO_CLIENT_SECRET_ARN is configured and Secrets Manager is accessible
    if (!secretArn) {
        console.warn(
            'COGNITO_CLIENT_SECRET_ARN not configured - using SSM parameter only. ' +
                'Rotation overlap period support is DISABLED. Only current client ID will be accepted.',
        )
    }

    try {
        const ssmResponse = await ssmClient.send(
            new GetParameterCommand({ Name: parameterName }),
        )

        if (!ssmResponse.Parameter?.Value) {
            throw new Error(`SSM parameter ${parameterName} has no value`)
        }

        const current = ssmResponse.Parameter.Value

        cognitoClientIdsCache = {
            current,
            previous: null,
            timestamp: now,
        }

        return {
            current,
            previous: null,
        }
    } catch (error) {
        console.error('Error fetching Cognito client ID from SSM:', error)
        throw new Error(
            `Failed to fetch Cognito client ID from SSM: ${parameterName}`,
        )
    }
}

/**
 * Get current Cognito client ID (for backward compatibility)
 * @deprecated Use getCognitoClientIds instead to support overlap period
 */
export async function getCognitoClientId(
    parameterName: string,
): Promise<string> {
    // This function signature doesn't have secretArn, so we can't support overlap
    // But we'll try to read from SSM as fallback
    const ssmResponse = await ssmClient.send(
        new GetParameterCommand({ Name: parameterName }),
    )

    if (!ssmResponse.Parameter?.Value) {
        throw new Error(`SSM parameter ${parameterName} has no value`)
    }

    return ssmResponse.Parameter.Value
}
