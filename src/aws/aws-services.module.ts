import { Module } from '@nestjs/common'
import { LoggerModule } from '../logger-v2'
import {
    CognitoIDPService,
    EcsService,
    LambdaService,
    RdsSignerService,
    S3Service,
    SNSService,
    SQSService,
    SecretsManagerService,
    SesService,
    SmsService,
    SsmParamService,
} from './services'

@Module({
    imports: [LoggerModule],
    providers: [
        S3Service,
        SecretsManagerService,
        SNSService,
        SQSService,
        RdsSignerService,
        SsmParamService,
        LambdaService,
        EcsService,
        SmsService,
        SesService,
        CognitoIDPService,
    ],
    exports: [
        S3Service,
        SecretsManagerService,
        SNSService,
        SQSService,
        RdsSignerService,
        SsmParamService,
        LambdaService,
        EcsService,
        SmsService,
        SesService,
        CognitoIDPService,
    ],
})
export class AwsServicesModule {}
