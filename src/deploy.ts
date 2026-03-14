#!/usr/bin/env node
import {
    GetFunctionCommand,
    LambdaClient,
    UpdateFunctionCodeCommand,
} from '@aws-sdk/client-lambda'
import type { SpawnOptionsWithoutStdio } from 'child_process'
import { spawn } from 'child_process'
import * as dotenv from 'dotenv'
import { readFileSync } from 'fs'
import * as path from 'path'
import yargs from 'yargs'

dotenv.config()

// Constants
const IMAGE_TAG = 'latest'
const PLATFORM = 'linux/amd64'

interface Config {
    region: string
    ecrRegistryName: string
    repoName: string
    lambdaName?: string
    deployToLambda: boolean
    skipBuild: boolean
    skipPush: boolean
    localTag?: string
}

interface SpawnResult {
    stdoutData: string
    stderrData: string
    exitCode: number | null
}

// Command line argument parsing
const parseArgs = () => {
    return yargs
        .usage('Usage: $0 --lambda <LambdaName> --skip-build --skip-push')
        .option('lambda', {
            alias: 'l',
            describe: 'A lambda name to update with the new image',
            type: 'string',
        })
        .option('skip-build', {
            alias: 'sb',
            describe: 'Skip building the image',
            type: 'boolean',
        })
        .option('skip-push', {
            alias: 'sp',
            describe: 'Skip pushing the image',
            type: 'boolean',
        })
        .parseSync()
}

class ConfigurationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ConfigurationError'
    }
}

const getPackageJson = (appRootPath?: string): Record<string, unknown> => {
    const packageJsonPath = appRootPath
        ? path.join(appRootPath, 'package.json')
        : path.join(__dirname, '../../../../../package.json')

    try {
        return JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    } catch (err) {
        const errorMessage =
            err instanceof Error ? err.message : 'Unknown error'
        throw new ConfigurationError(
            `Error reading package.json at ${packageJsonPath} - ${errorMessage}\n` +
                'If running locally, ensure APP_ROOT_PATH is set in your .env file.',
        )
    }
}

const getConfig = (): Config => {
    const argv = parseArgs()
    const region = process.env.AWS_REGION
    const account = process.env.AWS_ACCOUNT

    if (!region) throw new ConfigurationError('AWS_REGION not set')
    if (!account) throw new ConfigurationError('AWS_ACCOUNT not set')

    const packageJson = getPackageJson(process.env.APP_ROOT_PATH)
    const repoName = packageJson.name

    if (!repoName || typeof repoName !== 'string')
        throw new ConfigurationError('package.json missing name field')

    const ecrRegistryName = `${account}.dkr.ecr.${region}.amazonaws.com`
    const localTag = `${repoName}:${IMAGE_TAG}`
    const deployToLambda = Boolean(argv.lambda)

    return {
        region,
        ecrRegistryName,
        repoName,
        lambdaName: argv.lambda,
        deployToLambda,
        skipBuild: Boolean(argv.skipBuild),
        skipPush: Boolean(argv.skipPush),
        localTag,
    }
}

const promiseSpawn = (
    command: string,
    args: string[],
    options?: SpawnOptionsWithoutStdio,
    log = true,
): Promise<SpawnResult> => {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, options)
        let stdoutData = ''
        let stderrData = ''

        if (log) {
            child.stdout.pipe(process.stdout)
            child.stderr.pipe(process.stderr)
        }

        child.stdout.on('data', (data) => {
            stdoutData += data.toString()
        })

        child.stderr.on('data', (data) => {
            stderrData += data.toString()
        })

        child.on('close', (code) => {
            if (code !== 0) {
                reject(
                    new Error(
                        `Command failed with exit code ${code}. stderr: ${stderrData}`,
                    ),
                )
            } else {
                resolve({ stdoutData, stderrData, exitCode: code })
            }
        })

        child.on('error', (err) => {
            reject(new Error(`Failed to start command: ${err.message}`))
        })
    })
}

const loginEcs = async (config: Config): Promise<void> => {
    const { region, ecrRegistryName } = config
    try {
        await promiseSpawn('sh', [
            '-c',
            `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecrRegistryName}`,
        ])
    } catch (error) {
        throw new Error(
            `ECR login failed: ${
                error instanceof Error ? error.message : 'Unknown error'
            }`,
        )
    }
}

const buildImage = async (config: Config): Promise<void> => {
    const { ecrRegistryName, repoName, deployToLambda, skipPush } = config
    const remoteTag = `${ecrRegistryName}/${repoName}:${IMAGE_TAG}`

    // Use buildx with provenance/sbom disabled so the image uses Docker v2 manifest
    // format, which AWS Lambda requires (OCI/provenance manifests are not supported).
    const args = [
        'buildx',
        'build',
        '--platform',
        PLATFORM,
        '--provenance',
        'false',
        '--sbom',
        'false',
        '-t',
        remoteTag,
        '.',
    ]

    if (deployToLambda) {
        args.push('--target', 'lambda')
    }

    if (skipPush) {
        args.push('-t', `${repoName}:${IMAGE_TAG}`, '--load')
    } else {
        args.push('--push')
    }

    try {
        await promiseSpawn('docker', args)
    } catch (error) {
        throw new Error(
            `Docker build failed: ${
                error instanceof Error ? error.message : 'Unknown error'
            }`,
        )
    }
}

const pushImage = async (config: Config): Promise<void> => {
    const { ecrRegistryName, repoName, skipBuild } = config
    // When we built in this run, we already pushed in buildImage (buildx --push)
    if (!skipBuild) return

    try {
        await promiseSpawn('docker', [
            'push',
            `${ecrRegistryName}/${repoName}:${IMAGE_TAG}`,
        ])
    } catch (error) {
        throw new Error(
            `Docker push failed: ${
                error instanceof Error ? error.message : 'Unknown error'
            }`,
        )
    }
}

const updateLambdaImage = async (lambdaName: string): Promise<void> => {
    const client = new LambdaClient({})

    try {
        const func = await client.send(
            new GetFunctionCommand({ FunctionName: lambdaName }),
        )

        const imageUri = func.Code?.ImageUri
        if (!imageUri) {
            throw new Error(`Could not find image uri for lambda ${lambdaName}`)
        }

        await client.send(
            new UpdateFunctionCodeCommand({
                ImageUri: imageUri,
                FunctionName: lambdaName,
            }),
        )

        console.log('### Initiated lambda update ###')
    } catch (error) {
        throw new Error(
            `Lambda update failed: ${
                error instanceof Error ? error.message : 'Unknown error'
            }`,
        )
    }
}

const main = async () => {
    console.log('### Starting deployment ###')
    try {
        const config = getConfig()
        console.log(`### Config:\n${JSON.stringify(config, null, 2)} ###`)

        if (!config.skipBuild) {
            console.log('### Logging in to ECR ###')
            await loginEcs(config)
            console.log('### Building image ###')
            await buildImage(config)
        }

        if (!config.skipPush) {
            console.log('### Pushing image ###')
            await pushImage(config)
        }

        if (config.lambdaName) {
            console.log('### Updating lambda image ###')
            await updateLambdaImage(config.lambdaName)
        }

        console.log('### Deployment completed successfully ###')
    } catch (error) {
        console.error('### Deployment failed ###')
        console.error(error instanceof Error ? error.message : error)
        process.exit(1)
    }
}

void main()
