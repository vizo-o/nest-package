import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs'

/**
 * Mock AWS CloudWatch Logs client for testing
 */
export class MockCloudWatchLogsClient extends CloudWatchLogsClient {
    public sentCommands: Array<{
        command: string
        input: Record<string, unknown>
    }> = []

    async send(command: {
        constructor: { name: string }
        input: Record<string, unknown>
    }): Promise<Record<string, unknown>> {
        this.sentCommands.push({
            command: command.constructor.name,
            input: command.input,
        })

        return await Promise.resolve({})
    }

    clear(): void {
        this.sentCommands = []
    }
}

/**
 * Create a mock CloudWatch client for testing
 */
export function createMockCloudWatchClient(): MockCloudWatchLogsClient {
    return new MockCloudWatchLogsClient({})
}
