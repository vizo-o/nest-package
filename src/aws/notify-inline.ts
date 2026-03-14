import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import dotenv from 'dotenv'
import { NotificationChannel } from './entities'
dotenv.config()

const appName = process.env.APP_NAME || 'UnknownService'
const appEnv = process.env.ENV || process.env.NODE_ENV || 'unknown'

const notificationChannelTopicArnMap = new Map<string, string>()

const getTopicArn = async (channel: string) => {
    if (!notificationChannelTopicArnMap.has(channel)) {
        const ssmClient = new SSMClient({})
        const response = await ssmClient.send(
            new GetParameterCommand({
                Name: `/notification/${channel
                    .toLowerCase()
                    .replace('_', '-')}-topic-arn`,
            }),
        )
        if (!response.Parameter?.Value) {
            throw new Error(
                `SNS notifications: topicArn for channel ${channel} is not set`,
            )
        }

        notificationChannelTopicArnMap.set(channel, response.Parameter.Value)
    }

    return notificationChannelTopicArnMap.get(channel)
}
const getEnvironmentEmoji = (env: string): string => {
    switch (env.toLowerCase()) {
        case 'prod':
            return '🔴'
        case 'staging':
            return '🟡'
        default:
            return '🟢'
    }
}

export const notify = async ({
    notificationChannels,
    subject,
    message,
}: {
    notificationChannels: NotificationChannel[] | NotificationChannel
    subject: string
    message: string
}) => {
    if (!Array.isArray(notificationChannels)) {
        notificationChannels = [notificationChannels]
    }

    if (process.env.ENV === 'local' && process.env?.LOCAL_SEND_SNS !== 'true') {
        return
    }

    console.log(
        `Notifying channels ${notificationChannels.join(
            ', ',
        )} with subject:${subject}`,
    )

    const snsClient = new SNSClient({})
    for (const channel of notificationChannels) {
        const TopicArn = await getTopicArn(channel)

        let finalSubject = subject
        let finalMessage = message

        // Add environment info only for admin notifications
        if (channel === NotificationChannel.ADMIN) {
            const envEmoji = getEnvironmentEmoji(appEnv)
            finalSubject = `${envEmoji} [${appEnv.toUpperCase()}] [${appName}] ${subject}`
            finalMessage = [
                `${envEmoji} ENVIRONMENT: ${appEnv.toUpperCase()} ${envEmoji}`,
                `📦 SERVICE: ${appName}`,
                '',
                message,
            ].join('\n')
        }

        // Truncate subject to 100 characters (SNS limit)
        // SNS Subject must be non-empty and max 100 characters
        if (finalSubject.length > 100) {
            finalSubject = `${finalSubject.substring(0, 97)}...`
        }

        // Ensure subject is not empty (SNS requirement)
        if (!finalSubject || finalSubject.trim().length === 0) {
            finalSubject = 'Notification'
        }

        const publishResult = await snsClient.send(
            new PublishCommand({
                TopicArn,
                Subject: finalSubject,
                Message: finalMessage,
            }),
        )

        if (!publishResult.MessageId) {
            throw new Error(
                `SNS notifications: failed to send message, channel: ${channel}, errorCode: ${publishResult.$metadata.httpStatusCode}`,
            )
        }
    }
}
