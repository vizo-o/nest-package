#!/usr/bin/env node
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
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
        choices: ['migrate', 'reset-db', 'invoke-migration'] as const,
        default: 'migrate',
    })
    .option('gitSha', {
        describe: 'Commit SHA (for migration runner payload)',
        type: 'string',
    })
    .option('githubRunId', {
        describe: 'GitHub Actions run id (for migration artifact)',
        type: 'string',
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
    }

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

const decodeLambdaLogTail = (logResult: string | undefined) => {
    if (!logResult) {
        return
    }
    try {
        const decoded = Buffer.from(logResult, 'base64').toString('utf-8')
        console.log('--- Migration Lambda logs ---')
        console.log(decoded)
        console.log('--- end Migration Lambda logs ---')
    } catch {
        console.log('Could not decode Lambda log tail')
    }
}

const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
    })

const isMigrationLambdaBusy = (error: unknown): boolean => {
    if (!error || typeof error !== 'object' || !('name' in error)) {
        return false
    }
    const name = String((error as { name: string }).name)
    return (
        name === 'TooManyRequestsException' ||
        name === 'ConcurrentInvocationLimitExceeded'
    )
}

const invokeMigrationLambda = async () => {
    const functionName = await getSSMParameter(
        `/${repoName}/migration-lambda-function-name`,
    )
    if (!functionName) {
        throw new Error(
            `invokeMigrationLambda: missing SSM /${repoName}/migration-lambda-function-name`,
        )
    }

    const runId =
        argv.githubRunId ??
        process.env.GITHUB_RUN_ID ??
        process.env.GITHUB_RUN_NUMBER
    if (!runId) {
        throw new Error(
            'invokeMigrationLambda: missing githubRunId (or GITHUB_RUN_ID env)',
        )
    }

    const gitSha = argv.gitSha ?? process.env.GITHUB_SHA
    const repository =
        process.env.GITHUB_REPOSITORY ?? `vizo-o/${repoName}`
    const [githubOwner, githubRepo] = repository.includes('/')
        ? (repository.split('/') as [string, string])
        : ['vizo-o', repoName]

    const payload = {
        source: 'cicd-migrate' as const,
        repoName,
        runId: String(runId),
        gitSha,
        githubOwner,
        githubRepo,
        artifactName: 'migration-lambda-zip',
    }

    console.log(`Invoking migration Lambda: ${functionName}`)
    const lambdaClient = new LambdaClient({})
    const maxAttempts = 36
    let response

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            response = await lambdaClient.send(
                new InvokeCommand({
                    FunctionName: functionName,
                    InvocationType: 'RequestResponse',
                    LogType: 'Tail',
                    Payload: Buffer.from(JSON.stringify(payload)),
                }),
            )
            break
        } catch (error) {
            if (isMigrationLambdaBusy(error) && attempt < maxAttempts) {
                console.log(
                    `Migration Lambda busy (reserved concurrency); retry ${attempt}/${maxAttempts} in 10s`,
                )
                await sleep(10_000)
                continue
            }
            throw error
        }
    }

    if (!response) {
        throw new Error(
            'Migration Lambda invoke did not return a response after retries',
        )
    }

    decodeLambdaLogTail(response.LogResult)

    if (response.FunctionError) {
        const payloadText = response.Payload
            ? Buffer.from(response.Payload).toString('utf-8')
            : ''
        throw new Error(
            `Migration Lambda failed (${response.FunctionError}): ${payloadText}`,
        )
    }

    if (response.StatusCode !== 200) {
        throw new Error(
            `Migration Lambda invoke returned status ${response.StatusCode}`,
        )
    }

    console.log(`${repoName} migration Lambda completed successfully`)
}

const bootstrap = async () => {
    try {
        if (argv.action === 'migrate') {
            await runTask()
        } else if (argv.action === 'reset-db') {
            await runTask('reset-db')
        } else if (argv.action === 'invoke-migration') {
            await invokeMigrationLambda()
        }
    } catch (error) {
        console.error('Error: ', error)
        await reportError(error, {
            category: 'infrastructure',
            title: `Migration failed for ${repoName}`,
            description: `Failed to execute ${argv.action} action`,
        })
        process.exit(1)
    }
}

void bootstrap()
