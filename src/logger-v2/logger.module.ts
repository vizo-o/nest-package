import { Global, Module } from '@nestjs/common'
import { LoggerService } from './logger.service'

/**
 * LoggerModule exporting the new LoggerService
 * Use this module in new projects (e.g., admin-system)
 */
@Global()
@Module({
    providers: [LoggerService],
    exports: [LoggerService],
})
export class LoggerModule {}
