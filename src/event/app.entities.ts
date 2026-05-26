import type { EventBase } from './entities'

export enum Service {
    OPERATIONAL = 'OPERATIONAL',
    CLINICAL = 'CLINICAL',
    FORMS = 'FORMS',
    MD_PORTAL = 'MD_PORTAL',
    ADMIN = 'ADMIN',
}
export enum JourneyType {
    PRODUCT = 'product',
    FOLLOWUP = 'followup',
}
export enum OperationalEventTypes {
    GET_FORM_DATA = 'GET_FORM_DATA',
    GET_CUSTOMER_COMMUNICATION_CHANNELS = 'GET_CUSTOMER_COMMUNICATION_CHANNELS',
    GET_CUSTOMER_UNMASKED_COMMUNICATION_CHANNEL = 'GET_CUSTOMER_UNMASKED_COMMUNICATION_CHANNEL',
    UPDATE_CUSTOMER_STATUS = 'UPDATE_CUSTOMER_STATUS',
    GET_CUSTOMER_DATA = 'GET_CUSTOMER_DATA',
    PROPAGATE_FORM = 'PROPAGATE_FORM',
    SYNC_MONDAY_LEADS_AND_CUSTOMERS = 'SYNC_MONDAY_LEADS_AND_CUSTOMERS',
    SMS_RECEIVED = 'SMS_RECEIVED',
    ADDITIONAL_DATA_APPROVAL_REQUEST = 'ADDITIONAL_DATA_APPROVAL_REQUEST',
    REMIND_APPLICATIONS = 'REMIND_APPLICATIONS',
    SYNC_MD_PORTAL_APPLICATION_STATUS_TO_MONDAY = 'SYNC_MD_PORTAL_APPLICATION_STATUS_TO_MONDAY',
    PROCESS_INVOICE_FILE = 'PROCESS_INVOICE_FILE',
    DELETE_CUSTOMER = 'DELETE_CUSTOMER',
    GET_VIZO_IDS_BY_PHONE = 'GET_VIZO_IDS_BY_PHONE',
    GET_VIZO_IDS_BY_EMAIL = 'GET_VIZO_IDS_BY_EMAIL',
    GET_CUSTOMER_CONTACT_METHODS = 'GET_CUSTOMER_CONTACT_METHODS',
    PROCESS_GAMING_ORDER = 'PROCESS_GAMING_ORDER',
    GET_CUSTOMER_PRODUCT_STATUS = 'GET_CUSTOMER_PRODUCT_STATUS',
    REGISTER_MD_PORTAL_APPLICATION = 'REGISTER_MD_PORTAL_APPLICATION',
}

export type GetFormDataEvent = {
    type: OperationalEventTypes.GET_FORM_DATA
    formName: string
    vizoId: string
}

export type GetCustomerCommunicationChannels = {
    type: OperationalEventTypes.GET_CUSTOMER_COMMUNICATION_CHANNELS
    vizoId: string
}

export type GetCustomerUnmaskedCommunicationChannel = {
    type: OperationalEventTypes.GET_CUSTOMER_UNMASKED_COMMUNICATION_CHANNEL
    vizoId: string
    communicationChannel: 'email' | { id: number }
}

export type UpdateCustomerStatus = {
    type: OperationalEventTypes.UPDATE_CUSTOMER_STATUS
    vizoId: string
    applicationStatus?: string
    mdApprovalStatus?: string
    mdPortalStatus?: string
    asrsFormStatus?: string
    asrsFormType?: string
    followUpSurveyCompletionStatus?: string
}

export type GetCustomerData = {
    type: OperationalEventTypes.GET_CUSTOMER_DATA
    applicationId: string
}

export type PropagateFormEvent = {
    type: OperationalEventTypes.PROPAGATE_FORM
    formName: string
    vizoId: string
    data: { key: string; value: string | number }[]
}

export type SmsReceivedEvent = {
    type: OperationalEventTypes.SMS_RECEIVED
    originationNumber: string
    message: string
}

export type RemindApplicationsEvent = {
    type: OperationalEventTypes.REMIND_APPLICATIONS
}

export type SyncMdPortalApplicationStatusToMondayEvent = {
    type: OperationalEventTypes.SYNC_MD_PORTAL_APPLICATION_STATUS_TO_MONDAY
    vizoIds?: string[]
    mode?: 'dryRun' | 'realRun'
    updateApplicationStatus?: boolean
    batchSize?: number
    batchIndex?: number
}

export type ProcessInvoiceFileEvent = {
    type: OperationalEventTypes.PROCESS_INVOICE_FILE
    fileRecordId: string
    s3Key: string
}

export type DeleteOperationalCustomerEvent = {
    type: OperationalEventTypes.DELETE_CUSTOMER
    vizoId: string
}

export type GetVizoIdsByPhoneEvent = {
    type: OperationalEventTypes.GET_VIZO_IDS_BY_PHONE
    phoneNumber: string
}

export type GetVizoIdsByEmailEvent = {
    type: OperationalEventTypes.GET_VIZO_IDS_BY_EMAIL
    email: string
}

/** Pass exactly one of vizoId or adjustmentCentersExternalId. */
export type GetCustomerContactMethodsEvent = {
    type: OperationalEventTypes.GET_CUSTOMER_CONTACT_METHODS
    vizoId?: string
    adjustmentCentersExternalId?: string
}

/**
 * Face mesh payload for PROCESS_GAMING_ORDER after face-scan-to-S3 rollout.
 * Only explicit PD mesh indices (no dense MediaPipe landmark array).
 */
export type ProcessGamingOrderFaceScanV2 = {
    data: {
        imgSize: { imgWidth: number; imgHeight: number }
        landmarksPdMesh: Array<{
            index: number
            x: number
            y: number
            z: number
        }>
        meta: { version: 2 }
        faceScanImageS3Key?: string
        faceScanLandmarksArtifactS3Key?: string
        faceScanArtifactsBucket?: string
    }
}

/** One catalog line in onboarding SQS body; frame/color are per product — not on event root. */
export type ProcessGamingOrderProduct = {
    sku: string
    frame: string
    color: string
    commercialName: string
    requiresPrescription: boolean
}

export type ProcessGamingOrderEvent = {
    type: OperationalEventTypes.PROCESS_GAMING_ORDER
    PurchaseID: string
    OrderReceivedDate: string
    products: ProcessGamingOrderProduct[]
    PD: { left: string; right: string }
    PDType?: string
    hasNearPd?: boolean
    nearPd?: { monocular?: string; left?: string; right?: string }
    RightEye: {
        sphere: string
        cylinder: string
        axis: string
        addition: string
    }
    LeftEye: {
        sphere: string
        cylinder: string
        axis: string
        addition: string
    }
    FaceScan?: ProcessGamingOrderFaceScanV2
    CognitiveGame?: unknown
    SkillsAssessment?: {
        ratings: {
            reactionTime: number
            spatialAwareness: number
            adaptability: number
            problemSolving: number
            mentalResilience: number
        }
    }
    prescriptionImageS3Key?: string
    prescriptionDocumentS3Keys?: string[]
    originalPrescriptionDocumentS3Key?: string
    prescriptionDocumentS3Bucket?: string
    prescriptionMethod?: 'manual' | 'upload'
    prescriptionValidityConfirmed?: boolean
    purchaseSource?: string
    specialOptics?: string
    vv?: string
    vizoId?: string
    customerId?: string
}

export type GetCustomerProductStatusEvent = {
    type: OperationalEventTypes.GET_CUSTOMER_PRODUCT_STATUS
    vizoId: string
}

export type RegisterMdPortalApplicationEvent = {
    type: OperationalEventTypes.REGISTER_MD_PORTAL_APPLICATION
    vizoId: string
    applicationId: string
}

type OperationalEventBase =
    | GetFormDataEvent
    | GetCustomerCommunicationChannels
    | GetCustomerUnmaskedCommunicationChannel
    | UpdateCustomerStatus
    | GetCustomerData
    | PropagateFormEvent
    | SmsReceivedEvent
    | RemindApplicationsEvent
    | SyncMdPortalApplicationStatusToMondayEvent
    | ProcessInvoiceFileEvent
    | DeleteOperationalCustomerEvent
    | GetVizoIdsByPhoneEvent
    | GetVizoIdsByEmailEvent
    | GetCustomerContactMethodsEvent
    | ProcessGamingOrderEvent
    | GetCustomerProductStatusEvent
    | RegisterMdPortalApplicationEvent

export type OperationalEvent = EventBase | OperationalEventBase

export enum ClinicalEventTypes {
    SYNC_SUBJECTS = 'SYNC_SUBJECTS',
    PROPAGATE_CUSTOMIZATION_DATA = 'PROPAGATE_CUSTOMIZATION_DATA',
    GET_FINAL_SPEC_RECIPES = 'GET_FINAL_SPEC_RECIPES',
    GET_SUBJECT_CUSTOMIZATION_DATA = 'GET_SUBJECT_CUSTOMIZATION_DATA',
    DELETE_SUBJECT = 'DELETE_SUBJECT',
}

export type SyncSubjectsEvent = {
    type: ClinicalEventTypes.SYNC_SUBJECTS
    data: { vizoId: string }[]
}

export type SpecRecipeCreateData = {
    customerId: string
    specType: string
    specRole: string
    pdLeft: number
    pdRight: number
    vertex: number
}

export type PropagateCustomizationDataEvent = {
    type: ClinicalEventTypes.PROPAGATE_CUSTOMIZATION_DATA
    vizoId: string
    data: { sensoryModulationSensitivityGrade: string }
}

export type GetFinalSpecRecipesEvent = {
    type: ClinicalEventTypes.GET_FINAL_SPEC_RECIPES
    data: {
        vizoId: string
        finalModel: string
        optometryPDLeftFar: number
        optometryPDRightFar: number
        dominantEye: string
        specType?: string
        optometryVertex?: number
    }[]
}

export type GetSubjectCustomizationDataEvent = {
    type: ClinicalEventTypes.GET_SUBJECT_CUSTOMIZATION_DATA
    vizoId: string
}

export type DeleteClinicalSubjectEvent = {
    type: ClinicalEventTypes.DELETE_SUBJECT
    vizoId: string
}

type ClinicalEventBase =
    | SyncSubjectsEvent
    | PropagateCustomizationDataEvent
    | GetFinalSpecRecipesEvent
    | GetSubjectCustomizationDataEvent
    | DeleteClinicalSubjectEvent
export type ClinicalEvent = EventBase | ClinicalEventBase

export enum FormsEventTypes {
    PLACE_HOLDER = 'PLACE_HOLDER',
}

export type FormsEventBase = {
    type: FormsEventTypes.PLACE_HOLDER
}

export type FormsEvent = FormsEventBase | EventBase

export enum MdPortalEventTypes {
    STOP_APPLICATION = 'STOP_APPLICATION',
    SEND_MONTHLY_DOCTOR_ASSIGNMENT_REPORT = 'SEND_MONTHLY_DOCTOR_ASSIGNMENT_REPORT',
    PROCESS_PDF_FILES = 'PROCESS_PDF_FILES',
    PROCESS_PDF_FILES_MISSING_PAGES = 'PROCESS_PDF_FILES_MISSING_PAGES',
    DELETE_SUBJECT = 'DELETE_SUBJECT',
    CREATE_CUSTOMER_JOURNEY = 'CREATE_CUSTOMER_JOURNEY',
}

export type StopApplicationEvent = {
    type: MdPortalEventTypes.STOP_APPLICATION
    applicationId: string
}

export type SendMonthlyDoctorAssignmentReportEvent = {
    type: MdPortalEventTypes.SEND_MONTHLY_DOCTOR_ASSIGNMENT_REPORT
}

export type ProcessPdfFilesEvent = {
    type: MdPortalEventTypes.PROCESS_PDF_FILES
    fileRecordIds: string[]
}

export type ProcessPdfFilesMissingPagesEvent = {
    type: MdPortalEventTypes.PROCESS_PDF_FILES_MISSING_PAGES
    takePdfs?: number
    vizoIds?: string[]
}

export type DeleteMdPortalSubjectEvent = {
    type: MdPortalEventTypes.DELETE_SUBJECT
    vizoId: string
}

export type CreateCustomerJourneyEvent = {
    type: MdPortalEventTypes.CREATE_CUSTOMER_JOURNEY
    vizoId: string
    journeyType: 'product' | 'followup'
    ageGroup?: 'child' | 'adult'
    gender?: 'male' | 'female' | 'other'
    specificAgeGroup?: '7-12' | '12-18' | '18-30' | '30-50' | '50+'
    applicationId?: string
    includeClinicalForms?: boolean
}

export type MdPortalEventBase =
    | StopApplicationEvent
    | SendMonthlyDoctorAssignmentReportEvent
    | ProcessPdfFilesEvent
    | ProcessPdfFilesMissingPagesEvent
    | DeleteMdPortalSubjectEvent
    | CreateCustomerJourneyEvent
export type MdPortalEvent = EventBase | MdPortalEventBase

export enum AdminEventTypes {
    INCIDENT_CREATED = 'INCIDENT_CREATED',
    INCIDENT_RESOLVED = 'INCIDENT_RESOLVED',
    INCIDENT_ACKNOWLEDGED = 'INCIDENT_ACKNOWLEDGED',
    INCIDENT_STATUS_CHANGED = 'INCIDENT_STATUS_CHANGED',
    NOTIFICATION_SENT = 'NOTIFICATION_SENT',
    SERVICE_ERROR = 'SERVICE_ERROR',
    HEALTH_CHECK_FAILED = 'HEALTH_CHECK_FAILED',
    // Queue routing events
    INCIDENT_PROCESSING_QUEUE = 'INCIDENT_PROCESSING_QUEUE',
    NOTIFICATION_QUEUE = 'NOTIFICATION_QUEUE',
    LIFECYCLE_QUEUE = 'LIFECYCLE_QUEUE',
}

export type IncidentCreatedEvent = {
    type: AdminEventTypes.INCIDENT_CREATED
    service: string
    fingerprint: string
    title: string
    description?: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    errorType?: string
    endpoint?: string
    scheduledJob?: string
    metadata?: Record<string, unknown>
}

export type IncidentResolvedEvent = {
    type: AdminEventTypes.INCIDENT_RESOLVED
    incidentId: string
    resolvedBy?: string
    resolution?: string
}

export type IncidentAcknowledgedEvent = {
    type: AdminEventTypes.INCIDENT_ACKNOWLEDGED
    incidentId: string
    acknowledgedBy: string
}

export type IncidentStatusChangedEvent = {
    type: AdminEventTypes.INCIDENT_STATUS_CHANGED
    incidentId: string
    oldStatus: string
    newStatus: string
    changedBy?: string
}

export type NotificationSentEvent = {
    type: AdminEventTypes.NOTIFICATION_SENT
    incidentId: string
    channel: 'email'
    recipient: string
    success: boolean
    error?: string
}

export type ServiceErrorEvent = {
    type: AdminEventTypes.SERVICE_ERROR
    service: string
    error: string
    stackTrace?: string
    endpoint?: string
    userId?: string
    requestId?: string
    metadata?: Record<string, unknown>
}

export type IncidentProcessingQueueEvent = {
    type: AdminEventTypes.INCIDENT_PROCESSING_QUEUE
    service: string
    errorType?: string
    endpoint?: string
    scheduledJob?: string
    title: string
    description?: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    metadata?: Record<string, unknown>
    keyDetails: string
    correlationId?: string // Root correlation ID for grouping related incidents
    parentRequestId?: string // Immediate parent's request ID
    callChain?: string[] // Full call chain showing service flow
}

export type NotificationQueueEvent = {
    type: AdminEventTypes.NOTIFICATION_QUEUE
    incidentId: string
    timestamp: string
}

export type LifecycleQueueEvent = {
    type: AdminEventTypes.LIFECYCLE_QUEUE
    messageType: 'auto_resolution_check' | 'escalation_check' | 'status_update'
    incidentId?: string
    timestamp: string
    metadata?: Record<string, unknown>
}

export type AdminEventBase =
    | IncidentCreatedEvent
    | IncidentResolvedEvent
    | IncidentAcknowledgedEvent
    | IncidentStatusChangedEvent
    | NotificationSentEvent
    | ServiceErrorEvent
    | IncidentProcessingQueueEvent
    | NotificationQueueEvent
    | LifecycleQueueEvent

export type AdminEvent = EventBase | AdminEventBase

export type Event =
    | OperationalEvent
    | ClinicalEvent
    | FormsEvent
    | MdPortalEvent
    | AdminEvent
