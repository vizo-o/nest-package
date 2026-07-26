import { LoggerService } from '../logger-v2';

import type { InputLogEvent } from '@aws-sdk/client-cloudwatch-logs'
import {
    CloudWatchLogsClient,
    PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import type { ListUsersCommandOutput } from '@aws-sdk/client-cognito-identity-provider'
import {
    AdminCreateUserCommand,
    AdminDeleteUserAttributesCommand,
    AdminDeleteUserCommand,
    AdminInitiateAuthCommand,
    AdminRespondToAuthChallengeCommand,
    AdminSetUserMFAPreferenceCommand,
    AdminUpdateUserAttributesCommand,
    AssociateSoftwareTokenCommand,
    CognitoIdentityProviderClient,
    GetUserCommand,
    ListUsersCommand,
    VerifySoftwareTokenCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDB } from '@aws-sdk/client-dynamodb'
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs'
import type { InvocationRequest } from '@aws-sdk/client-lambda'
import {
    InvocationType,
    InvokeCommand,
    LambdaClient,
} from '@aws-sdk/client-lambda'
import {
    PinpointSMSVoiceV2Client,
    SendTextMessageCommand,
} from '@aws-sdk/client-pinpoint-sms-voice-v2'
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3'
import {
    GetSecretValueCommand,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { Signer } from '@aws-sdk/rds-signer'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Injectable } from '@nestjs/common'
import fs from 'fs'
import * as crypto from 'node:crypto'
import type { Readable } from 'stream'
import type { Service } from '../event/app.entities'

import { getTraceContextForDownstream } from '../trace'
import { NotificationChannel } from './entities'
import { notify } from './notify-inline'
import { reportError, type ErrorContext } from './report-error'

const DEFAULT_PRESIGNED_URL_EXPIRATION_SECONDS = 30

@Injectable()
export class S3Service {
    readonly client: S3Client

    constructor() {
        this.client = new S3Client({})
    }

    async getObject({ bucket, key }: { bucket: string; key: string }) {
        const fileObject = await this.client.send(
            new GetObjectCommand({ Bucket: bucket, Key: key }),
        )

        return fileObject.Body as Readable
    }

    async getObjectString({ bucket, key }: { bucket: string; key: string }) {
        const fileObject = await this.getObject({ bucket, key })

        return this.streamToString(fileObject)
    }

    async downloadObject({
        bucket,
        key,
        path,
    }: {
        bucket: string
        key: string
        path: string
    }) {
        const fileObject = await this.getObject({ bucket, key })

        return this.streamToFile(fileObject, path)
    }

    async copyObject({
        sourceBucket,
        sourceKey,
        targetBucket,
        targetKey,
    }: {
        sourceBucket: string
        sourceKey: string
        targetBucket: string
        targetKey: string
    }) {
        return this.client.send(
            new PutObjectCommand({
                Bucket: targetBucket,
                Key: targetKey,
                Body: await this.getObjectString({
                    bucket: sourceBucket,
                    key: sourceKey,
                }),
            }),
        )
    }

    deleteObject({ bucket, key }: { bucket: string; key: string }) {
        return this.client.send(
            new DeleteObjectCommand({
                Bucket: bucket,
                Key: key,
            }),
        )
    }

    putObject({
        key,
        bucket,
        data,
        contentType,
    }: {
        key: string
        bucket: string
        data: Buffer
        contentType?: string
    }) {
        return this.client.send(
            new PutObjectCommand({
                Key: key,
                Bucket: bucket,
                Body: data,
                // This metadata is part of a cloud overflow prevention strategy.
                // It is intended to prevent the lambda from triggering any events
                // on the generated file event.
                // In the event service file process method we will check if this is set,
                // and if it is, we will log it as ignored, and not process any event handlers
                // for the file.
                Metadata: { 'lambda-ignore': 'true' },
                ...(contentType && { ContentType: contentType }),
            }),
        )
    }

    async getPresignedDownloadUrl({
        key,
        bucket,
        expirationSeconds = DEFAULT_PRESIGNED_URL_EXPIRATION_SECONDS,
    }: {
        key: string
        bucket: string
        expirationSeconds?: number
    }) {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        })

        // Generate the presigned URL
        try {
            const presignedUrl = await getSignedUrl(this.client, command, {
                expiresIn: expirationSeconds,
            })

            return presignedUrl
        } catch (error) {
            console.error('Error generating presigned URL:', error)
            throw error
        }
    }

    getMetadata({ key, bucket }: { key: string; bucket: string }) {
        return this.client.send(
            new HeadObjectCommand({
                Key: key,
                Bucket: bucket,
            }),
        )
    }

    private streamToString = async (stream: Readable) => {
        const chunks: Buffer[] = []
        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk))
        }

        return Buffer.concat(chunks).toString('utf-8')
    }
    private streamToFile(stream: Readable, path: string): Promise<void> {
        const ws = fs.createWriteStream(path)

        return new Promise((resolve) => {
            stream.pipe(ws)
            stream.on('end', () => resolve())
        })
    }
}

@Injectable()
export class SecretsManagerService {
    private readonly client: SecretsManagerClient

    constructor() {
        this.client = new SecretsManagerClient({})
    }

    async getSecretValue(secretId: string) {
        const secret = await this.client.send(
            new GetSecretValueCommand({ SecretId: secretId }),
        )

        return secret.SecretString
    }
}

@Injectable()
export class SNSService {
    readonly client: SNSClient

    constructor() {
        this.client = new SNSClient({})
    }

    async publishMessage(topicArn: string, message: string, subject?: string) {
        await this.client.send(
            new PublishCommand({
                TopicArn: topicArn,
                Message: message,
                Subject: subject,
            }),
        )
    }
}

@Injectable()
export class SQSService {
    readonly client: SQSClient

    constructor() {
        this.client = new SQSClient({})
    }

    async sendMessage(queueUrl: string, messageBody: string) {
        await this.client.send(
            new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: messageBody,
            }),
        )
    }
}

@Injectable()
export class RdsSignerService {
    getAuthToken({
        username,
        hostname,
        port,
        region,
    }: {
        username: string
        hostname: string
        port: number
        region: string
    }) {
        const client = new Signer({
            hostname,
            port,
            username,
            region,
        })

        return client.getAuthToken()
    }
}

@Injectable()
export class SsmParamService {
    private readonly client = new SSMClient({})

    async getParameter(name: string) {
        const response = await this.client.send(
            new GetParameterCommand({
                Name: name,
            }),
        )

        return response.Parameter?.Value
    }
}

@Injectable()
export class LambdaService {
    private readonly client = new LambdaClient({})

    constructor(private readonly logger: LoggerService) {}

    dispatch<Event extends { type: string }>(service: Service, event: Event) {
        return this.invoke(
            `${service.toLowerCase().replace('_', '-')}-system-backend`,
            event,
            false,
        )
    }

    dispatchAsync<Event extends { type: string }>(
        service: Service,
        event: Event,
    ) {
        return this.invoke(
            `${service.toLowerCase().replace('_', '-')}-system-backend`,
            event,
            true,
        )
    }

    invokeFunction<TResponse = unknown>({
        functionName,
        payload,
        async = false,
    }: {
        functionName: string
        payload: unknown
        async?: boolean
    }): Promise<TResponse> {
        return this.invokeRaw(functionName, payload, async)
    }

    /**
     * Inject trace context into payload for downstream service calls
     * Automatically adds _traceContext field if trace context is available
     */
    private injectTraceContext(payload: unknown): unknown {
        const traceContext = getTraceContextForDownstream()
        if (!traceContext._traceContext) {
            // Log warning if trace context should be available but isn't
            console.warn(
                '[LambdaService] No trace context available for downstream call',
                {
                    hasPayload: !!payload,
                    payloadType:
                        payload &&
                        typeof payload === 'object' &&
                        'type' in payload
                            ? (payload as { type: string }).type
                            : 'unknown',
                },
            )

            return payload
        }

        // Spread trace context into payload
        return {
            ...(payload as object),
            ...traceContext,
        }
    }

    private async invoke(
        functionName: string,
        payload: unknown,
        async: boolean,
    ) {
        if (async) {
            return this.invokeRaw<{ status: number; message: string }>(
                functionName,
                payload,
                true,
            )
        }

        const response = await this.invokeRaw<{
            body?: string
            errorMessage?: string
        }>(functionName, payload, false)

        let body
        let data
        try {
            body = JSON.parse(response.body || '')[0]
        } catch {
            return {
                status: 500,
                message: `Received Error from ${functionName}, error:${
                    response.errorMessage ?? 'Error'
                }`,
                data: response,
            }
        }
        try {
            data = JSON.parse(body.data)
        } catch {
            data = body?.data
        }

        return {
            status: body.status || 200,
            message: body.message || 'Success',
            ...(data && { data }),
        }
    }

    private async invokeRaw<TResponse>(
        functionName: string,
        payload: unknown,
        async: boolean,
    ): Promise<TResponse> {
        const enrichedPayload = this.injectTraceContext(payload)

        const invokePayload: InvocationRequest = {
            FunctionName: functionName,
            Payload: Buffer.from(JSON.stringify(enrichedPayload)),
            InvocationType: async
                ? InvocationType.Event
                : InvocationType.RequestResponse,
        }

        const output = await this.client.send(new InvokeCommand(invokePayload))
        console.log(`${functionName} invoked`)

        if (async) {
            return {
                status: output.StatusCode || 202,
                message: 'Event dispatched',
            } as TResponse
        }

        if (output.FunctionError && output.FunctionError !== 'Unhandled') {
            throw new Error(output.FunctionError)
        }

        if (!output.Payload) {
            throw new Error(`Lambda ${functionName} returned empty payload`)
        }

        return JSON.parse(Buffer.from(output.Payload).toString()) as TResponse
    }
}

@Injectable()
export class EcsService {
    private readonly client = new ECSClient({})

    async launchFargateTask({
        cluster,
        taskDefinition,
        subnet,
        securityGroup,
        containerOverrides,
    }: {
        cluster: string
        taskDefinition: string
        subnet: string
        securityGroup: string
        containerOverrides: {
            name: string
            command?: string[]
            environment?: { name: string; value: string }[]
        }[]
    }) {
        const response = await this.client.send(
            new RunTaskCommand({
                cluster,
                taskDefinition,
                launchType: 'FARGATE',
                networkConfiguration: {
                    awsvpcConfiguration: {
                        subnets: [subnet],
                        securityGroups: [securityGroup],
                        assignPublicIp: 'ENABLED',
                    },
                },
                overrides: {
                    containerOverrides,
                },
            }),
        )

        return response.tasks
    }
}

@Injectable()
export class SmsService {
    private readonly client = new PinpointSMSVoiceV2Client({})
    async send({
        destinationNumber,
        message,
        originationPhoneNumber,
    }: {
        destinationNumber: string
        message: string
        originationPhoneNumber: string
    }) {
        if (process.env.ENV !== 'prod') {
            const adminMessage = `SMS not sent in non prod env, ${destinationNumber}:\n${message}`
            console.log(adminMessage)
            await notify({
                notificationChannels: [NotificationChannel.ADMIN],
                subject: `${process.env?.ENV?.toUpperCase()} SMS not sent in non prod env`,
                message: adminMessage,
            })

            return
        }

        if (process.env?.DISABLE_SMS === 'true') {
            console.error('SMS sending is disabled')

            return
        }

        try {
            return await this.client.send(
                new SendTextMessageCommand({
                    DestinationPhoneNumber: destinationNumber,
                    OriginationIdentity: originationPhoneNumber,
                    MessageBody: message,
                }),
            )
        } catch (error) {
            console.error('Error sending SMS:', error)
            const errorContext: ErrorContext = {
                service: process.env.APP_NAME,
                title: 'SMS sending failed',
                description: `Failed to send SMS to ${destinationNumber} from ${originationPhoneNumber}`,
                severity: 'high',
                category: 'external_service',
                metadata: {
                    destinationNumber,
                    originationPhoneNumber,
                },
            }
            await reportError(error, errorContext)
            throw error
        }
    }
}

interface SendEmailParams {
    to: string[]
    from: string
    subject: string
    htmlBody: string
    textBody?: string
    configurationSetName?: string
    silentDropBlockedRecipients?: boolean
}

export class BlockedEmailError extends Error {
    readonly reason: 'complaint' | 'bounce' | 'unknown'
    readonly emails: string[]

    constructor(reason: 'complaint' | 'bounce', emails: string[]) {
        super(`Emails blocked due to ${reason} status: ${emails.join(', ')}`)
        this.reason = reason
        this.emails = emails
        this.name = 'BlockedEmailError'
    }
}

interface EmailStatus {
    status: 'ACTIVE' | 'BOUNCED' | 'COMPLAINED'
}

@Injectable()
export class SesService {
    private readonly sesClient: SESv2Client
    private readonly dynamoClient: DynamoDB
    private readonly ssmService: SsmParamService
    private emailTableName: string | undefined
    private configSetName: string | undefined

    constructor() {
        this.sesClient = new SESv2Client({})
        this.dynamoClient = new DynamoDB({})
        this.ssmService = new SsmParamService()
    }

    private async initializeParams() {
        if (!this.emailTableName) {
            this.emailTableName = await this.ssmService.getParameter(
                '/email-status-table-name',
            )
        }
        if (!this.configSetName) {
            this.configSetName = await this.ssmService.getParameter(
                '/email-config-set-name',
            )
        }
    }

    private async checkEmailStatus(email: string): Promise<EmailStatus> {
        if (!this.emailTableName) {
            throw new Error('Email table name not initialized')
        }

        try {
            const result = await this.dynamoClient.getItem({
                TableName: this.emailTableName,
                Key: {
                    email: { S: email },
                },
            })

            if (!result.Item) {
                return { status: 'ACTIVE' } // Email not found in blocklist, safe to send
            }

            const status = result.Item.emailStatus.S as EmailStatus['status']

            return { status }
        } catch (error) {
            console.error(`Error checking email status for ${email}:`, error)
            throw error
        }
    }

    async sendEmail({
        to,
        from,
        subject,
        htmlBody,
        textBody,
        configurationSetName,
        silentDropBlockedRecipients = false,
    }: SendEmailParams) {
        let finalFrom = from
        await this.initializeParams()

        // Check status for all recipients
        const emailStatuses = await Promise.all(
            to.map(async (email) => ({
                email,
                status: await this.checkEmailStatus(email),
            })),
        )

        // Separate blocked and valid recipients
        const blockedEmails = {
            bounce: emailStatuses
                .filter(({ status }) => status.status === 'BOUNCED')
                .map(({ email }) => email),
            complaint: emailStatuses
                .filter(({ status }) => status.status === 'COMPLAINED')
                .map(({ email }) => email),
        }

        const validRecipients = emailStatuses
            .filter(({ status }) => status.status === 'ACTIVE')
            .map(({ email }) => email)

        // Handle blocked recipients
        if (blockedEmails.bounce.length > 0) {
            console.warn(
                `Emails blocked due to bounce status: ${blockedEmails.bounce.join(', ')}`,
            )
            if (!silentDropBlockedRecipients) {
                throw new BlockedEmailError('bounce', blockedEmails.bounce)
            }
        }

        if (blockedEmails.complaint.length > 0) {
            console.warn(
                `Emails blocked due to complaint status: ${blockedEmails.complaint.join(', ')}`,
            )
            if (!silentDropBlockedRecipients) {
                throw new BlockedEmailError(
                    'complaint',
                    blockedEmails.complaint,
                )
            }
        }

        if (validRecipients.length === 0) {
            console.warn(
                'No valid recipients after filtering bounced/complained emails',
            )

            return
        }

        // In non-prod environments, route all emails to dev@vizo-o.com
        if (process.env.ENV !== 'prod') {
            const devEmailFrom = process.env?.DEV_EMAIL_FROM ?? 'dev@vizo-o.com'
            console.log(`Routing non-prod email to ${devEmailFrom}`, {
                originalTo: validRecipients,
                from: devEmailFrom,
                subject,
            })
            // validRecipients.splice(0)
            // validRecipients.push(devEmailFrom)
            finalFrom = devEmailFrom
        }

        try {
            await this.sesClient.send(
                new SendEmailCommand({
                    FromEmailAddress: finalFrom,
                    Destination: {
                        ToAddresses: validRecipients,
                    },
                    Content: {
                        Simple: {
                            Subject: {
                                Data: subject,
                            },
                            Body: {
                                Html: {
                                    Data: htmlBody,
                                },
                                ...(textBody && {
                                    Text: {
                                        Data: textBody,
                                    },
                                }),
                            },
                        },
                    },
                    ConfigurationSetName:
                        configurationSetName ?? this.configSetName,
                }),
            )

            console.log(
                `Email sent successfully to ${validRecipients.join(', ')}`,
            )
        } catch (error) {
            console.error('Error sending email:', error)
            throw error
        }
    }
}

@Injectable()
export class CloudWatchService {
    private readonly client = new CloudWatchLogsClient({})

    putLogEvents({
        logGroupName,
        logStreamName,
        logEvents,
    }: {
        logGroupName: string
        logStreamName: string
        logEvents: InputLogEvent[]
    }) {
        return this.client.send(
            new PutLogEventsCommand({
                logGroupName,
                logStreamName,
                logEvents,
            }),
        )
    }
}

@Injectable()
export class CognitoIDPService {
    private readonly client = new CognitoIdentityProviderClient({})

    createUser({
        userPoolId,
        username,
    }: {
        userPoolId: string
        username: string
    }) {
        return this.client.send(
            new AdminCreateUserCommand({
                UserPoolId: userPoolId,
                Username: username,
                MessageAction: 'SUPPRESS',
            }),
        )
    }

    deleteUser({
        userPoolId,
        username,
    }: {
        userPoolId: string
        username: string
    }) {
        return this.client.send(
            new AdminDeleteUserCommand({
                UserPoolId: userPoolId,
                Username: username,
            }),
        )
    }

    updateUserAttributes({
        userPoolId,
        username,
        userAttributes,
    }: {
        userPoolId: string
        username: string
        userAttributes: Array<{ Name: string; Value: string }>
    }) {
        return this.client.send(
            new AdminUpdateUserAttributesCommand({
                UserPoolId: userPoolId,
                Username: username,
                UserAttributes: userAttributes,
            }),
        )
    }

    async getUsersCreatedBefore(params: {
        userPoolId: string
        before: Date
    }): Promise<ListUsersCommandOutput['Users']> {
        const { userPoolId, before } = params
        const cutoff = before.getTime()

        let paginationToken: string | undefined = undefined
        const matched: ListUsersCommandOutput['Users'] = []

        do {
            const resp: ListUsersCommandOutput = await this.client.send(
                new ListUsersCommand({
                    UserPoolId: userPoolId,
                    PaginationToken: paginationToken,
                    Limit: 60,
                }),
            )

            const users = resp.Users ?? []
            matched.push(
                ...users.filter(
                    (u) => (u.UserCreateDate?.getTime() ?? 0) < cutoff,
                ),
            )

            paginationToken = resp.PaginationToken
        } while (paginationToken)

        return matched
    }

    async initiateAuth({
        userPoolId,
        clientId,
        clientSecret,
        username,
        destination,
        otpMethod = 'sms',
    }: {
        userPoolId: string
        clientId: string
        clientSecret: string
        username: string
        destination: { email: string } | { phone: string }
        otpMethod?: 'sms' | 'voice' | 'email' | 'dev-bypass'
    }) {
        const secretHash = crypto
            .createHmac('sha256', clientSecret)
            .update(username + clientId)
            .digest('base64')

        const UserAttributes = [
            'phone' in destination
                ? {
                      Name: 'phone_number',
                      Value: destination.phone,
                  }
                : {
                      Name: 'email',
                      Value: destination.email,
                  },
            {
                Name: 'custom:otpMethod',
                Value: otpMethod,
            },
        ]

        await this.client.send(
            new AdminDeleteUserAttributesCommand({
                UserPoolId: userPoolId,
                Username: username,
                UserAttributeNames: ['phone_number', 'email'],
            }),
        )

        await this.client.send(
            new AdminUpdateUserAttributesCommand({
                UserPoolId: userPoolId,
                Username: username,
                UserAttributes,
            }),
        )

        return this.client.send(
            new AdminInitiateAuthCommand({
                UserPoolId: userPoolId,
                ClientId: clientId,
                AuthFlow: 'CUSTOM_AUTH',
                AuthParameters: {
                    USERNAME: username,
                    SECRET_HASH: secretHash,
                },
            }),
        )
    }

    respondToAuthChallenge({
        userPoolId,
        clientId,
        clientSecret,
        username,
        code,
        sessionId,
    }: {
        userPoolId: string
        clientId: string
        clientSecret: string
        username: string
        code: string
        sessionId: string
    }) {
        const secretHash = crypto
            .createHmac('sha256', clientSecret)
            .update(username + clientId)
            .digest('base64')

        return this.client.send(
            new AdminRespondToAuthChallengeCommand({
                UserPoolId: userPoolId,
                ClientId: clientId,
                ChallengeName: 'CUSTOM_CHALLENGE',
                ChallengeResponses: {
                    USERNAME: username,
                    SECRET_HASH: secretHash,
                    ANSWER: code,
                },
                Session: sessionId,
            }),
        )
    }

    refreshTokens({
        userPoolId,
        clientId,
        clientSecret,
        username,
        refreshToken,
    }: {
        userPoolId: string
        clientId: string
        clientSecret: string
        username: string
        refreshToken: string
    }) {
        const secretHash = crypto
            .createHmac('sha256', clientSecret)
            .update(username + clientId)
            .digest('base64')

        return this.client.send(
            new AdminInitiateAuthCommand({
                UserPoolId: userPoolId,
                ClientId: clientId,
                AuthFlow: 'REFRESH_TOKEN',
                AuthParameters: {
                    REFRESH_TOKEN: refreshToken,
                    SECRET_HASH: secretHash,
                    USERNAME: username,
                },
            }),
        )
    }

    /**
     * Sign in with email and password using USER_PASSWORD_AUTH flow
     * Returns authentication result which may include MFA challenge
     */
    signInWithPassword({
        userPoolId,
        clientId,
        username,
        password,
        clientSecret,
    }: {
        userPoolId: string
        clientId: string
        username: string
        password: string
        clientSecret?: string
    }) {
        const authParameters: Record<string, string> = {
            USERNAME: username,
            PASSWORD: password,
        }

        // Add SECRET_HASH if client secret is provided
        if (clientSecret) {
            const secretHash = crypto
                .createHmac('sha256', clientSecret)
                .update(username + clientId)
                .digest('base64')
            authParameters.SECRET_HASH = secretHash
        }

        return this.client.send(
            new AdminInitiateAuthCommand({
                UserPoolId: userPoolId,
                ClientId: clientId,
                AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
                AuthParameters: authParameters,
            }),
        )
    }

    /**
     * Respond to SOFTWARE_TOKEN_MFA challenge with TOTP code
     */
    respondToSoftwareTokenMfa({
        userPoolId,
        clientId,
        session,
        totpCode,
        username,
        clientSecret,
    }: {
        userPoolId: string
        clientId: string
        session: string
        totpCode: string
        username?: string
        clientSecret?: string
    }) {
        const challengeResponses: Record<string, string> = {
            SOFTWARE_TOKEN_MFA_CODE: totpCode,
        }

        // Add SECRET_HASH if client secret and username are provided
        if (clientSecret && username) {
            const secretHash = crypto
                .createHmac('sha256', clientSecret)
                .update(username + clientId)
                .digest('base64')
            challengeResponses.SECRET_HASH = secretHash
        }

        return this.client.send(
            new AdminRespondToAuthChallengeCommand({
                UserPoolId: userPoolId,
                ClientId: clientId,
                ChallengeName: 'SOFTWARE_TOKEN_MFA',
                ChallengeResponses: challengeResponses,
                Session: session,
            }),
        )
    }

    /**
     * Associate software token (TOTP) for first-time setup
     * Returns secret code for QR code generation
     */
    associateSoftwareToken({ accessToken }: { accessToken: string }) {
        return this.client.send(
            new AssociateSoftwareTokenCommand({
                AccessToken: accessToken,
            }),
        )
    }

    /**
     * Verify software token (TOTP) setup completion
     */
    verifySoftwareToken({
        accessToken,
        userCode,
        friendlyDeviceName,
    }: {
        accessToken: string
        userCode: string
        friendlyDeviceName?: string
    }) {
        return this.client.send(
            new VerifySoftwareTokenCommand({
                AccessToken: accessToken,
                UserCode: userCode,
                FriendlyDeviceName: friendlyDeviceName,
            }),
        )
    }

    /**
     * Get user information from access token
     * Can be used to verify token validity and extract user claims
     */
    getUserFromToken({ accessToken }: { accessToken: string }) {
        return this.client.send(
            new GetUserCommand({
                AccessToken: accessToken,
            }),
        )
    }

    /**
     * Admin: Set MFA preference for a user
     * Enables SOFTWARE_TOKEN_MFA as preferred MFA method
     */
    adminSetUserMfaPreference({
        userPoolId,
        username,
        softwareTokenMfaSettings,
    }: {
        userPoolId: string
        username: string
        softwareTokenMfaSettings?: {
            enabled: boolean
            preferredMfa?: boolean
        }
    }) {
        return this.client.send(
            new AdminSetUserMFAPreferenceCommand({
                UserPoolId: userPoolId,
                Username: username,
                SoftwareTokenMfaSettings: softwareTokenMfaSettings
                    ? {
                          Enabled: softwareTokenMfaSettings.enabled,
                          PreferredMfa:
                              softwareTokenMfaSettings.preferredMfa ?? true,
                      }
                    : undefined,
            }),
        )
    }
}
