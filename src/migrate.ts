#!/usr/bin/env node
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { Signer } from '@aws-sdk/rds-signer'
import { spawn } from 'child_process'
import yargs from 'yargs'
import { reportError } from './aws'

const kebabToSnake = (kebab: string) => kebab.replace(/-/g, '_')

const argv = yargs
    .option('repoName', {
        alias: 'r',
        describe: 'Repository name',
        demandOption: true,
        type: 'string',
    })
    .option('action', {
        alias: 'a',
        describe: 'Action to perform',
        demandOption: false,
        type: 'string',
        options: ['migrate', 'launch-task'],
        default: 'migrate',
    })
    .parseSync()

const { repoName } = argv
const username = 'migration'

const getSSMParameter = async (parameterName: string) => {
    const ssmClient = new SSMClient({})
    const response = await ssmClient.send(
        new GetParameterCommand({
            Name: parameterName,
        }),
    )

    return response.Parameter?.Value
}

const getDbUrl = async () => {
    if (process.env.DB_HOST) {
        if (!process.env.DB_PORT || !process.env.REGION) {
            throw new Error('getDbUrl: Missing db connection info')
        }

        const hostname = process.env.DB_HOST
        const port = parseInt(process.env.DB_PORT)
        const region = process.env.REGION

        const rdsSigner = new Signer({
            hostname,
            port,
            username,
            region,
        })

        const token = await rdsSigner.getAuthToken()

        const encodedToken = encodeURIComponent(token)

        return `postgres://${username}:${encodedToken}@${process.env.DB_HOST}:${
            process.env.DB_PORT
        }/${kebabToSnake(repoName)}?sslmode=require&sslcert=global-bundle.pem`
    } else
        return `postgresql://${username}:${username}@localhost:5432/${kebabToSnake(
            repoName,
        )}`
}

const runTask = async (task = 'migration') => {
    console.log(`*** Migrating ${kebabToSnake(repoName)}...`)

    const dbUrl = await getDbUrl()

    const migrationArgs = [
        'prisma',
        'migrate',
        'deploy',
        '--schema',
        './prisma/schema.prisma',
    ]

    const resetArgs = [
        'prisma',
        'migrate',
        'reset',
        '--schema',
        './prisma/schema.prisma',
        '--force',
    ]

    const args = task === 'migration' ? migrationArgs : resetArgs
    const taskString = task === 'migration' ? 'Migration' : 'Reset db'

    const taskResult = new Promise<void>((resolve, reject) => {
        const taskProcess = spawn('npx', args, {
            env: {
                ...process.env,
                DATABASE_URL: dbUrl,
            },
        })

        let stderrData = ''

        taskProcess.stdout.on('data', (data) => {
            console.log(data.toString())
        })

        taskProcess.stderr.on('data', (data) => {
            console.error(data.toString())
            stderrData += data.toString()
        })

        taskProcess.on('error', (error) => {
            reject(
                new Error(
                    `${taskString} process failed to start: ${error.message}`,
                ),
            )
        })

        taskProcess.on('exit', (code) => {
            if (code !== 0) {
                reject(
                    new Error(
                        `${taskString} process exited with code ${code}: ${stderrData}`,
                    ),
                )
            } else {
                resolve()
            }
        })
    })

    await taskResult
    console.log(`${taskString} completed successfully.`)
}

const launchTask = async (task = 'migration') => {
    console.log(`Launching ${task} task...`)

    const taskDefinitionArn = await getSSMParameter(
        `/${repoName}/migration-task-definition-arn`,
    )
    const securityGroupId = await getSSMParameter(
        '/infra-db/db-security-group-id',
    )
    const privateSubnets = (
        await getSSMParameter('/infra-base/vpc/private-subnets')
    )?.split(',')
    const clusterArn = await getSSMParameter(
        '/infra-db/database-task-cluster-arn',
    )
    if (
        !taskDefinitionArn ||
        !securityGroupId ||
        !privateSubnets ||
        !clusterArn
    ) {
        throw new Error('launchTask: Missing required parameters')
    }

    const ecsClient = new ECSClient({})
    const runTaskCommand = new RunTaskCommand({
        taskDefinition: taskDefinitionArn,
        cluster: clusterArn,
        launchType: 'FARGATE',
        networkConfiguration: {
            awsvpcConfiguration: {
                subnets: privateSubnets,
                securityGroups: [securityGroupId],
            },
        },
        ...(task === 'reset-db-launch-task' && {
            overrides: {
                containerOverrides: [
                    {
                        name: repoName,
                        command: ['npm run danger-reset-db'],
                    },
                ],
            },
        }),
    })

    const response = await ecsClient.send(runTaskCommand)
    if (response.failures && response.failures.length > 0) {
        console.log('Failures: ', response.failures)
        throw new Error(
            `launchTask failures reported:\n\t${response.failures
                .map((f) => f.reason)
                .join('\n\t')}`,
        )
    }
    if (!response.tasks || response.tasks.length === 0) {
        throw new Error('launchTask: No tasks returned')
    } else {
        console.log('Tasks: ', JSON.stringify(response.tasks))
    }

    console.log(`${repoName} migration task launched successfully`)
}

const bootstrap = async () => {
    try {
        if (argv.action === 'migrate') {
            await runTask()
        } else if (argv.action === 'reset-db') {
            await runTask('reset-db')
        } else if (argv.action === 'launch-task') {
            await launchTask()
        } else if (argv.action === 'reset-db-launch-task') {
            await launchTask('reset-db-launch-task')
        }
    } catch (error) {
        console.error('Error: ', error)
        await reportError(error, {
            category: 'infrastructure',
            title: `Migration task failed for ${repoName}`,
            description: `Failed to execute ${argv.action} action`,
        })
        process.exit(1)
    }
}

void bootstrap()
