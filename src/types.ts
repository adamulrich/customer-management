export type CustomerRecord = {
  id: string
  name: string
  address: string
  email: string
  phone: string
  contactPreference: '' | 'email' | 'sms'
  referralSource:
    | ''
    | 'google_search'
    | 'business_card_at_store'
    | 'friend_family'
    | 'social_media'
    | 'other'
  reminderOptIn: boolean
  reminderMonths: number
  followUpWeeks: number
  marketingOptIn: boolean
  notes: string
  lastReminderSentAt: string | null
  lastMarketingSentAt: string | null
  createdAt: string
  updatedAt: string
}

export type CustomerInput = Omit<
  CustomerRecord,
  'id' | 'createdAt' | 'updatedAt' | 'lastReminderSentAt' | 'lastMarketingSentAt'
> & {
  id?: string
}

export type AppointmentStatus = 'scheduled' | 'completed' | 'invoiced' | 'paid'
export type PaymentMethod = '' | 'cash' | 'check' | 'venmo'

export type AppointmentRecord = {
  id: string
  customerId: string
  customerName: string
  appointmentDate: string
  noCharge: boolean
  quotedEstimate: number
  travelCharge: number
  additionalCharges: number
  additionalChargeNote: string
  taxAmount: number
  paymentMethod: PaymentMethod
  notes: string
  status: AppointmentStatus
  invoiceSentAt: string | null
  followUpSentAt: string | null
  followUpCancelledAt: string | null
  createdAt: string
  updatedAt: string
}

export type AppointmentInput = Omit<
  AppointmentRecord,
  'id' | 'createdAt' | 'updatedAt' | 'invoiceSentAt' | 'followUpSentAt' | 'followUpCancelledAt'
> & {
  id?: string
}

export type BlockedDateRecord = {
  id: string
  startDate: string
  endDate: string
  reason: string
  createdAt: string
  updatedAt: string
}

export type BlockedDateInput = Omit<BlockedDateRecord, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

export type BusinessSettings = {
  id?: string
  businessName: string
  websiteUrl: string
  venmoHandle: string
  voicePhone: string
  defaultTravelCharge: number
  defaultPitchRaiseCharge: number
  defaultVoicingCharge: number
  defaultTaxRate: number
  defaultReminderMonths: number
  defaultFollowUpWeeks: number
  marketingExcludeMonths: number
  emailSignature: string
  smsSignature: string
}

export type CommunicationKind =
  | 'invoice'
  | 'reminder'
  | 'follow_up'
  | 'marketing'
  | 'appointment_confirmation'
  | 'appointment_reminder'
export type CommunicationChannel = 'email' | 'sms'

export type CommunicationLogRecord = {
  id: string
  channel: CommunicationChannel
  provider: string
  kind: CommunicationKind
  recipient: string
  subject: string
  body: string
  customerId: string
  appointmentId: string
  providerMessageId: string
  createdAt: string
  updatedAt: string
}

export type AppBackupFile = {
  format: 'prime-pianos-backup'
  version: 1
  exportedAt: string
  source: 'back4app'
  customers: CustomerRecord[]
  appointments: AppointmentRecord[]
  blockedDates: BlockedDateRecord[]
  communicationLogs: CommunicationLogRecord[]
  settings: BusinessSettings[]
}

export const defaultSettings: BusinessSettings = {
  businessName: 'Pitch Ledger Piano Tuning',
  websiteUrl: 'https://www.primepianos.com',
  venmoHandle: '',
  voicePhone: '(253) 900-9540',
  defaultTravelCharge: 25,
  defaultPitchRaiseCharge: 25,
  defaultVoicingCharge: 100,
  defaultTaxRate: 0.0825,
  defaultReminderMonths: 6,
  defaultFollowUpWeeks: 2,
  marketingExcludeMonths: 4,
  emailSignature: 'Thank you for supporting my piano tuning business.',
  smsSignature: 'Thanks again for having me tune your piano.',
}
