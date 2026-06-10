export type CustomerRecord = {
  id: string
  name: string
  address: string
  email: string
  phone: string
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

export type AppointmentRecord = {
  id: string
  customerId: string
  customerName: string
  appointmentDate: string
  quotedEstimate: number
  travelCharge: number
  additionalCharges: number
  additionalChargeNote: string
  taxAmount: number
  notes: string
  status: AppointmentStatus
  invoiceSentAt: string | null
  followUpSentAt: string | null
  createdAt: string
  updatedAt: string
}

export type AppointmentInput = Omit<
  AppointmentRecord,
  'id' | 'createdAt' | 'updatedAt' | 'invoiceSentAt' | 'followUpSentAt'
> & {
  id?: string
}

export type BusinessSettings = {
  id?: string
  businessName: string
  venmoHandle: string
  defaultTaxRate: number
  defaultReminderMonths: number
  defaultFollowUpWeeks: number
  marketingExcludeMonths: number
  emailSignature: string
  smsSignature: string
}

export const defaultSettings: BusinessSettings = {
  businessName: 'Pitch Ledger Piano Tuning',
  venmoHandle: '',
  defaultTaxRate: 0.0825,
  defaultReminderMonths: 6,
  defaultFollowUpWeeks: 2,
  marketingExcludeMonths: 4,
  emailSignature: 'Thank you for supporting my piano tuning business.',
  smsSignature: 'Thanks again for having me tune your piano.',
}
