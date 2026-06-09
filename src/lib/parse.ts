import {
  defaultSettings,
  type AppointmentInput,
  type AppointmentRecord,
  type BusinessSettings,
  type CustomerInput,
  type CustomerRecord,
} from '../types'
import type ParseType from 'parse'

let initialized = false
const SETTINGS_CLASS = 'Business_Settings'

const Parse = (globalThis as typeof globalThis & { Parse?: typeof ParseType }).Parse

if (!Parse) {
  throw new Error('Parse browser SDK failed to load. Expected window.Parse from /parse.min.js.')
}

const parseEnv = {
  appId: import.meta.env.VITE_PARSE_APP_ID?.trim(),
  javascriptKey: import.meta.env.VITE_PARSE_JAVASCRIPT_KEY?.trim(),
  serverURL: import.meta.env.VITE_PARSE_SERVER_URL?.trim(),
}

export function getMissingParseEnv() {
  return Object.entries({
    VITE_PARSE_APP_ID: parseEnv.appId,
    VITE_PARSE_JAVASCRIPT_KEY: parseEnv.javascriptKey,
    VITE_PARSE_SERVER_URL: parseEnv.serverURL,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key)
}

export function isParseConfigured() {
  return getMissingParseEnv().length === 0
}

export function initializeParse() {
  if (initialized || !isParseConfigured()) {
    return
  }

  Parse.initialize(parseEnv.appId!, parseEnv.javascriptKey!)
  Parse.serverURL = parseEnv.serverURL!
  Parse.User.enableUnsafeCurrentUser()
  initialized = true
}

function isMissingClassError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const parseError = error as { code?: number; message?: string }
  const message = parseError.message?.toLowerCase() ?? ''

  return (
    parseError.code === 101 ||
    parseError.code === 103 ||
    message.includes('class') && message.includes('not found')
  )
}

function requireUser() {
  initializeParse()
  const user = Parse.User.current()

  if (!user) {
    throw new Error('No logged-in user found.')
  }

  return user
}

function makePrivateAcl(user: Parse.User) {
  const acl = new Parse.ACL(user)
  acl.setPublicReadAccess(false)
  acl.setPublicWriteAccess(false)
  return acl
}

function toIsoString(value?: Date | null) {
  return value ? value.toISOString() : null
}

function toCustomerRecord(object: Parse.Object): CustomerRecord {
  return {
    id: object.id ?? '',
    name: object.get('name') ?? '',
    address: object.get('address') ?? '',
    email: object.get('email') ?? '',
    phone: object.get('phone') ?? '',
    reminderOptIn: Boolean(object.get('reminderOptIn')),
    reminderMonths: Number(object.get('reminderMonths') ?? defaultSettings.defaultReminderMonths),
    followUpWeeks: Number(object.get('followUpWeeks') ?? defaultSettings.defaultFollowUpWeeks),
    marketingOptIn: object.get('marketingOptIn') !== false,
    notes: object.get('notes') ?? '',
    lastReminderSentAt: toIsoString(object.get('lastReminderSentAt')),
    lastMarketingSentAt: toIsoString(object.get('lastMarketingSentAt')),
    createdAt: object.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: object.updatedAt?.toISOString() ?? new Date().toISOString(),
  }
}

function toAppointmentRecord(object: Parse.Object): AppointmentRecord {
  return {
    id: object.id ?? '',
    customerId: object.get('customerId') ?? '',
    customerName: object.get('customerName') ?? '',
    appointmentDate: object.get('appointmentDate')?.toISOString() ?? new Date().toISOString(),
    basePrice: Number(object.get('basePrice') ?? 0),
    taxAmount: Number(object.get('taxAmount') ?? 0),
    notes: object.get('notes') ?? '',
    status: object.get('status') ?? 'scheduled',
    invoiceSentAt: toIsoString(object.get('invoiceSentAt')),
    followUpSentAt: toIsoString(object.get('followUpSentAt')),
    createdAt: object.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: object.updatedAt?.toISOString() ?? new Date().toISOString(),
  }
}

function toSettingsRecord(object: Parse.Object): BusinessSettings {
  return {
    id: object.id,
    businessName: object.get('businessName') ?? defaultSettings.businessName,
    venmoHandle: object.get('venmoHandle') ?? '',
    defaultTaxRate: Number(object.get('defaultTaxRate') ?? defaultSettings.defaultTaxRate),
    defaultReminderMonths: Number(
      object.get('defaultReminderMonths') ?? defaultSettings.defaultReminderMonths,
    ),
    defaultFollowUpWeeks: Number(
      object.get('defaultFollowUpWeeks') ?? defaultSettings.defaultFollowUpWeeks,
    ),
    marketingExcludeMonths: Number(
      object.get('marketingExcludeMonths') ?? defaultSettings.marketingExcludeMonths,
    ),
    emailSignature: object.get('emailSignature') ?? defaultSettings.emailSignature,
    smsSignature: object.get('smsSignature') ?? defaultSettings.smsSignature,
  }
}

export function getCurrentUser() {
  initializeParse()
  return Parse.User.current()
}

export async function login(username: string, password: string) {
  initializeParse()
  return Parse.User.logIn(username, password)
}

export async function logout() {
  initializeParse()
  await Parse.User.logOut()
}

export async function fetchCustomers() {
  requireUser()
  const query = new Parse.Query('Customer')
  query.ascending('name')
  query.limit(500)
  try {
    const results = await query.find()
    return results.map(toCustomerRecord)
  } catch (error) {
    if (isMissingClassError(error)) {
      return []
    }
    throw error
  }
}

export async function saveCustomer(input: CustomerInput) {
  const user = requireUser()
  const record = input.id ? await new Parse.Query('Customer').get(input.id) : new Parse.Object('Customer')

  if (!input.id) {
    record.setACL(makePrivateAcl(user))
  }

  record.set('ownerId', user.id)
  record.set('ownerUsername', user.getUsername())
  record.set('name', input.name.trim())
  record.set('address', input.address.trim())
  record.set('email', input.email.trim())
  record.set('phone', input.phone.trim())
  record.set('reminderOptIn', input.reminderOptIn)
  record.set('reminderMonths', input.reminderMonths)
  record.set('followUpWeeks', input.followUpWeeks)
  record.set('marketingOptIn', input.marketingOptIn)
  record.set('notes', input.notes.trim())

  const saved = await record.save()
  return toCustomerRecord(saved)
}

export async function deleteCustomer(customerId: string) {
  requireUser()
  const customer = await new Parse.Query('Customer').get(customerId)
  await customer.destroy()

  const appointmentQuery = new Parse.Query('Appointment')
  appointmentQuery.equalTo('customerId', customerId)
  appointmentQuery.limit(500)
  const appointments = await appointmentQuery.find()

  if (appointments.length > 0) {
    await Parse.Object.destroyAll(appointments)
  }
}

export async function fetchAppointments() {
  requireUser()
  const query = new Parse.Query('Appointment')
  query.descending('appointmentDate')
  query.limit(1000)
  try {
    const results = await query.find()
    return results.map(toAppointmentRecord)
  } catch (error) {
    if (isMissingClassError(error)) {
      return []
    }
    throw error
  }
}

export async function saveAppointment(input: AppointmentInput) {
  const user = requireUser()
  const record = input.id
    ? await new Parse.Query('Appointment').get(input.id)
    : new Parse.Object('Appointment')

  if (!input.id) {
    record.setACL(makePrivateAcl(user))
  }

  record.set('ownerId', user.id)
  record.set('ownerUsername', user.getUsername())
  record.set('customerId', input.customerId)
  record.set('customerName', input.customerName.trim())
  record.set('appointmentDate', new Date(input.appointmentDate))
  record.set('basePrice', input.basePrice)
  record.set('taxAmount', input.taxAmount)
  record.set('notes', input.notes.trim())
  record.set('status', input.status)

  const saved = await record.save()
  return toAppointmentRecord(saved)
}

export async function deleteAppointment(appointmentId: string) {
  requireUser()
  const appointment = await new Parse.Query('Appointment').get(appointmentId)
  await appointment.destroy()
}

export async function markInvoiceSent(appointmentId: string) {
  requireUser()
  const appointment = await new Parse.Query('Appointment').get(appointmentId)
  appointment.set('invoiceSentAt', new Date())
  if (appointment.get('status') === 'scheduled') {
    appointment.set('status', 'invoiced')
  }
  const saved = await appointment.save()
  return toAppointmentRecord(saved)
}

export async function markFollowUpSent(appointmentId: string) {
  requireUser()
  const appointment = await new Parse.Query('Appointment').get(appointmentId)
  appointment.set('followUpSentAt', new Date())
  const saved = await appointment.save()
  return toAppointmentRecord(saved)
}

export async function markReminderSent(customerId: string) {
  requireUser()
  const customer = await new Parse.Query('Customer').get(customerId)
  customer.set('lastReminderSentAt', new Date())
  const saved = await customer.save()
  return toCustomerRecord(saved)
}

export async function markMarketingSent(customerIds: string[]) {
  requireUser()
  if (customerIds.length === 0) {
    return []
  }

  const query = new Parse.Query('Customer')
  query.containedIn('objectId', customerIds)
  query.limit(500)
  const customers = await query.find()
  customers.forEach((customer: Parse.Object) =>
    customer.set('lastMarketingSentAt', new Date()),
  )
  const saved = await Parse.Object.saveAll(customers)
  return saved.map(toCustomerRecord)
}

export async function fetchSettings() {
  requireUser()
  const query = new Parse.Query(SETTINGS_CLASS)
  query.descending('updatedAt')
  query.limit(1)
  try {
    const result = await query.first()
    return result ? toSettingsRecord(result) : defaultSettings
  } catch (error) {
    if (isMissingClassError(error)) {
      return defaultSettings
    }
    throw error
  }
}

export async function saveSettings(input: BusinessSettings) {
  const user = requireUser()
  const record = input.id
    ? await new Parse.Query(SETTINGS_CLASS).get(input.id)
    : new Parse.Object(SETTINGS_CLASS)

  if (!input.id) {
    record.setACL(makePrivateAcl(user))
  }

  record.set('ownerId', user.id)
  record.set('ownerUsername', user.getUsername())
  record.set('businessName', input.businessName.trim())
  record.set('venmoHandle', input.venmoHandle.trim().replace(/^@/, ''))
  record.set('defaultTaxRate', input.defaultTaxRate)
  record.set('defaultReminderMonths', input.defaultReminderMonths)
  record.set('defaultFollowUpWeeks', input.defaultFollowUpWeeks)
  record.set('marketingExcludeMonths', input.marketingExcludeMonths)
  record.set('emailSignature', input.emailSignature.trim())
  record.set('smsSignature', input.smsSignature.trim())

  const saved = await record.save()
  return toSettingsRecord(saved)
}

type EmailPayload = {
  to: string | string[]
  subject: string
  text: string
  html?: string
  customerId?: string
  appointmentId?: string
  kind: 'invoice' | 'reminder' | 'follow_up' | 'marketing'
}

type SmsPayload = {
  to: string
  body: string
  customerId?: string
  appointmentId?: string
  kind: 'invoice' | 'reminder' | 'follow_up'
}

type MarketingPayload = {
  to: string[]
  subject: string
  text: string
  html?: string
  customerIds: string[]
}

export async function sendBusinessEmail(payload: EmailPayload) {
  requireUser()
  return Parse.Cloud.run('sendBusinessEmail', payload)
}

export async function sendBusinessSms(payload: SmsPayload) {
  requireUser()
  return Parse.Cloud.run('sendBusinessSms', payload)
}

export async function sendMarketingBlast(payload: MarketingPayload) {
  requireUser()
  return Parse.Cloud.run('sendMarketingBlast', payload)
}
