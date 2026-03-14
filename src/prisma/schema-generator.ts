#!/usr/bin/env node

import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { plural } from 'pluralize'

const PRISMA_CONFIG_PATH = './prisma/config.json'
const PRISMA_MAIN_SCHEMA_PATH = './prisma/main.schema.prisma'
const PRISMA_GENERATED_SCHEMA_PATH = './prisma/schema.prisma'
const PRISMA_SCHEMAS_PATH =
    './node_modules/@vizo-o/vizo-package-nestjs/src/prisma/schemas/'

const toLowerSnakeCase = (str: string) => {
    const rawStr = str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

    return rawStr.startsWith('_') ? rawStr.substring(1) : rawStr
}

const pluralizeAndSnakeCase = (modelName: string) =>
    toLowerSnakeCase(plural(modelName))

const parsePrismaSchema = (schemaText: string) => {
    const sections = {
        generator: '',
        datasource: '',
        models: '',
        enums: '',
    }

    const lines = schemaText.split('\n')
    let currentSection: keyof typeof sections | null = null
    let currentModel = ''
    let currentEnum = ''

    for (const line of lines) {
        if (line.startsWith('generator')) {
            currentSection = 'generator'
            if (currentModel) {
                sections.models += processModel(currentModel)
                currentModel = ''
            }
            if (currentEnum) {
                sections.enums += processEnum(currentEnum)
                currentEnum = ''
            }
        } else if (line.startsWith('datasource')) {
            currentSection = 'datasource'
            if (currentModel) {
                sections.models += processModel(currentModel)
                currentModel = ''
            }
            if (currentEnum) {
                sections.enums += processEnum(currentEnum)
                currentEnum = ''
            }
        } else if (line.startsWith('model')) {
            if (currentModel) {
                sections.models += processModel(currentModel)
                currentModel = ''
            }
            if (currentEnum) {
                sections.enums += processEnum(currentEnum)
                currentEnum = ''
            }
            currentSection = 'models'
            currentModel += `${line}\n`
            continue
        } else if (line.startsWith('enum')) {
            if (currentModel) {
                sections.models += processModel(currentModel)
                currentModel = ''
            }
            if (currentEnum) {
                sections.enums += processEnum(currentEnum)
                currentEnum = ''
            }
            currentSection = 'enums'
            currentEnum += `${line}\n`
            continue
        }

        if (currentSection === 'models' && currentModel !== null) {
            currentModel += `${line}\n`
        } else if (currentSection === 'enums' && currentEnum !== null) {
            currentEnum += `${line}\n`
        } else if (currentSection) {
            sections[currentSection] += `${line}\n`
        }
    }

    if (currentModel) {
        sections.models += processModel(currentModel)
    }
    if (currentEnum) {
        sections.enums += processEnum(currentEnum)
    }

    return sections
}

const processEnum = (enumText: string) => {
    const lines = enumText.split('\n')
    const processedLines = []

    for (let line of lines) {
        const trimmedLine = line.trim().replace(/\s+/g, ' ')
        if (
            trimmedLine &&
            !trimmedLine.startsWith('//') &&
            !trimmedLine.startsWith('@@') &&
            !trimmedLine.startsWith('enum') &&
            !trimmedLine.startsWith('}')
        ) {
            const enumValue = trimmedLine
            const lowerSnakeCaseValue = toLowerSnakeCase(enumValue)
            if (!trimmedLine.includes('@map')) {
                line += ` @map("${lowerSnakeCaseValue}")`
            }
        }
        processedLines.push(line)
    }

    // Check for @@map directive and ensure it's properly positioned
    const enumMapDirectiveIndex = processedLines.findIndex((line) =>
        line.trim().startsWith('@@map'),
    )
    const enumNameMatch = enumText.match(/enum (\w+)/)
    if (enumNameMatch) {
        const enumName = enumNameMatch[1]
        const tableName = toLowerSnakeCase(enumName)
        const mapDirective = `\t@@map("${tableName}")`

        if (enumMapDirectiveIndex !== -1) {
            // Replace existing @@map directive at the correct position
            processedLines[enumMapDirectiveIndex] = mapDirective
        } else {
            // Find the position right before the closing brace
            const closingBraceIndex = processedLines.findIndex(
                (line) => line.trim() === '}',
            )
            if (closingBraceIndex !== -1) {
                // Insert @@map directive before the closing brace
                processedLines.splice(closingBraceIndex, 0, mapDirective)
            } else {
                // If no closing brace found (unexpected), append to the end
                processedLines.push(mapDirective)
            }
        }

        return processedLines.join('\n')
    }

    return processedLines.join('\n')
}

const processModel = (modelText: string) => {
    const lines = modelText.split('\n')
    const processedLines = []

    for (let line of lines) {
        const trimmedLine = line.trim().replace(/\s+/g, ' ')
        // If it's an @@index directive line, pass it through as is
        if (trimmedLine.startsWith('@@index')) {
            processedLines.push(line)
            continue
        }
        // Identify if it's a column line based on the new criteria
        if (
            trimmedLine &&
            !trimmedLine.startsWith('//') &&
            !trimmedLine.startsWith('@@') &&
            !(trimmedLine.startsWith('model') && trimmedLine.endsWith('{'))
        ) {
            const firstSpaceIndex = trimmedLine.indexOf(' ')
            const columnName = trimmedLine.substring(0, firstSpaceIndex)
            const snakeCaseColumnName = toLowerSnakeCase(columnName)
            if (
                !trimmedLine.includes('@map') &&
                trimmedLine !== '}' &&
                !trimmedLine.includes('@relation')
            ) {
                line += ` @map("${snakeCaseColumnName}")`
            }
        }
        processedLines.push(line)
    }

    // Check for @@map directive and ensure it's properly positioned
    const modelMapDirectiveIndex = processedLines.findIndex((line) =>
        line.trim().startsWith('@@map'),
    )
    const modelNameMatch = modelText.match(/model (\w+)/)
    if (modelNameMatch) {
        const modelName = modelNameMatch[1]
        const tableName = pluralizeAndSnakeCase(modelName)
        const mapDirective = `\t@@map("${tableName}")`

        if (modelMapDirectiveIndex !== -1) {
            // Replace existing @@map directive at the correct position
            processedLines[modelMapDirectiveIndex] = mapDirective
        } else {
            // Find the position right before the closing brace
            const closingBraceIndex = processedLines.findIndex(
                (line) => line.trim() === '}',
            )
            if (closingBraceIndex !== -1) {
                // Insert @@map directive before the closing brace
                processedLines.splice(closingBraceIndex, 0, mapDirective)
            } else {
                // If no closing brace found (unexpected), append to the end
                processedLines.push(mapDirective)
            }
        }

        return processedLines.join('\n')
    }
}

const addSchemaToDatasource = (datasource: string, newSchema: string) => {
    const schemaPattern = /schemas\s*=\s*\[([^\]]*)\]/
    const match = datasource.match(schemaPattern)

    if (match && match[1]) {
        // Avoiding duplicate schema entries
        if (!match[1].includes(newSchema)) {
            const updatedSchemas = match[1]
                .trim()
                .split(',')
                .concat(newSchema.trim())
                .join(', ')

            return datasource.replace(
                schemaPattern,
                `schemas = [${updatedSchemas}]`,
            )
        }
    }

    return datasource
}

const clearImplicitRelationMappings = (schema: string) => {
    const lines = schema.split('\n')
    const processedLines = []

    for (let line of lines) {
        const trimmedLine = line.trim().replace(/\s+/g, ' ')
        const dataType = trimmedLine
            ?.split(' ')?.[1]
            ?.replace('?', '')
            ?.replace('[]', '')
        const escapedDataType =
            dataType?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || ''
        const isImplicitRelationWithMapping =
            dataType &&
            new RegExp(`model\\s+${escapedDataType}(\\s|\\{)`).test(schema) &&
            trimmedLine.includes('@map')

        if (isImplicitRelationWithMapping) {
            // remove the @map directive
            line = line.replace(/@map\(".*"\)/, '')
        }
        processedLines.push(line)
    }

    return processedLines.join('\n')
}

const oneToOnePackageSideRelation = ({
    consumingModel,
    packageModel,
    relationName,
    required,
    sections,
}: {
    consumingModel: string
    packageModel: string
    relationName: string
    required: boolean
    sections: {
        models: string
        enums: string
    }
}) => {
    const firstLineOfPackageModelIndex = sections.models.indexOf(
        `model ${packageModel}`,
    )
    const firstPackageDirectiveLine = sections.models.indexOf(
        '@@',
        firstLineOfPackageModelIndex,
    )
    const relationLineInsertIndex = firstPackageDirectiveLine - 3
    const relationLine = `  ${relationName}Of ${consumingModel}${
        required ? '' : '?'
    } @relation(name: "${relationName}${packageModel}")\n`
    sections.models =
        sections.models.slice(0, relationLineInsertIndex) +
        relationLine +
        sections.models.slice(relationLineInsertIndex)
}

const manyToOnePackageSideRelation = ({
    consumingModel,
    packageModel,
    relationName,
    sections,
}: {
    consumingModel: string
    packageModel: string
    relationName: string
    sections: {
        models: string
        enums: string
    }
}) => {
    const firstLineOfPackageModelIndex = sections.models.indexOf(
        `model ${packageModel}`,
    )
    const firstPackageDirectiveLine = sections.models.indexOf(
        '@@',
        firstLineOfPackageModelIndex,
    )
    const relationLineInsertIndex = firstPackageDirectiveLine - 3
    const relationLine = `  ${relationName} ${consumingModel}[]\n`
    sections.models =
        sections.models.slice(0, relationLineInsertIndex) +
        relationLine +
        sections.models.slice(relationLineInsertIndex)
}

export const schemaGenerator = () => {
    const config = JSON.parse(readFileSync(PRISMA_CONFIG_PATH, 'utf8'))
    const schemaText = readFileSync(PRISMA_MAIN_SCHEMA_PATH, 'utf8')
    const sections = parsePrismaSchema(schemaText)

    for (const schema of config.packageSchemas) {
        sections.datasource = addSchemaToDatasource(
            sections.datasource,
            `"${schema.name}"`,
        )
        const rawModels = readFileSync(
            `${PRISMA_SCHEMAS_PATH}${schema.name}.schema.prisma`,
            'utf8',
        )
        const { models: parsedModels, enums: parsedEnums } =
            parsePrismaSchema(rawModels)
        sections.models += parsedModels
        sections.enums += parsedEnums

        if (schema.relations && schema.relations.length > 0) {
            for (const relation of schema.relations) {
                const [consumingModel, packageModel] = relation.between
                const relationType = relation.type
                const relationName = relation.relationName
                const required = relation.required

                switch (relationType) {
                    default:
                        throw new Error(
                            `Unsupported relation type: ${relationType}`,
                        )
                    case 'one-to-one':
                        oneToOnePackageSideRelation({
                            consumingModel,
                            packageModel,
                            relationName,
                            required,
                            sections,
                        })
                        break
                    case 'many-to-one':
                        manyToOnePackageSideRelation({
                            consumingModel,
                            packageModel,
                            relationName,
                            sections,
                        })
                }
            }
        }
    }

    const prefix =
        '// This file is generated by @vizo-o/vizo-package-nestjs/src/prisma/schemaGenerator.\n' +
        '// It should be checked in.\n' +
        '// Do not modify it directly.\n\n' +
        '// You may change the application schema in the prisma/main.schema.prisma file,\n' +
        '// or update prisma/config.json to add package based schemas.\n\n'

    const updatedSchema = clearImplicitRelationMappings(
        prefix +
            sections.generator +
            sections.datasource +
            sections.models +
            sections.enums,
    )

    writeFileSync(PRISMA_GENERATED_SCHEMA_PATH, updatedSchema, 'utf8')

    execSync('npx prisma format', { stdio: 'inherit' })
}

if (require.main === module) {
    try {
        console.log('Generating prisma schema...')
        schemaGenerator()
        console.log('Prisma schema generated.')
    } catch (error) {
        console.error('Error generating prisma schema', error)
        process.exit(1)
    }
}
