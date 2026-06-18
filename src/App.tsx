import { useEffect, useEffectEvent, useState } from 'react'
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
} from 'date-fns'
import './App.css'
import {
  createAppBackup,
  cancelFollowUp,
  deleteAppointment,
  deleteCustomer,
  fetchAppointments,
  fetchCommunicationLogs,
  fetchCustomers,
  fetchSettings,
  getCurrentUser,
  getMissingParseEnv,
  isParseConfigured,
  login,
  logout,
  markFollowUpSent,
  markInvoiceSent,
  markMarketingSent,
  markReminderSent,
  saveManualCommunicationLog,
  saveAppointment,
  saveCustomer,
  saveSettings,
  sendBusinessEmail,
  sendBusinessSms,
  sendMarketingBlast,
} from './lib/parse'
import {
  type CommunicationLogRecord,
  type CommunicationKind,
  type CommunicationChannel,
  defaultSettings,
  type AppointmentInput,
  type AppointmentRecord,
  type PaymentMethod,
  type AppointmentStatus,
  type BusinessSettings,
  type CustomerInput,
  type CustomerRecord,
} from './types'

const navigation = [
  ['customers', 'Customers'],
  ['reports', 'Sales Reports'],
  ['appointments', 'Appointments'],
  ['history', 'Service History'],
  ['invoices', 'Invoicing'],
  ['followups', 'Follow-ups'],
  ['communications', 'Communication Log'],
  ['backup', 'Data Backup'],
  ['settings', 'Settings'],
] as const

type TabKey = (typeof navigation)[number][0]
type LegacyTabKey = TabKey | 'workflows'

type DetailOrigin = {
  label: string
  tab: TabKey
}

const defaultCustomerDetailOrigin: DetailOrigin = {
  label: 'directory',
  tab: 'customers',
}

const defaultAppointmentDetailOrigin: DetailOrigin = {
  label: 'calendar',
  tab: 'appointments',
}

function detailOrigin(tab: TabKey, label?: string): DetailOrigin {
  const navLabel = navigation.find(([key]) => key === tab)?.[1].toLowerCase() ?? tab
  return {
    label: label ?? navLabel,
    tab,
  }
}

const GOOGLE_REVIEW_LINK = 'https://g.page/r/CUfNAU9Ogl_-EAE/review'
const STANDARD_APPOINTMENT_TOTAL = 150
const REPAIR_AMOUNT_OPTIONS = Array.from({ length: 61 }, (_, index) => index * 5)

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 12a2 2 0 0 1-2-2V8h12v11a2 2 0 0 1-2 2H8z"
        fill="currentColor"
      />
    </svg>
  )
}

const emptyCustomerForm = (settings: BusinessSettings): CustomerInput => ({
  name: '',
  address: '',
  email: '',
  phone: '',
  contactPreference: '',
  referralSource: '',
  reminderOptIn: true,
  reminderMonths: settings.defaultReminderMonths,
  followUpWeeks: settings.defaultFollowUpWeeks,
  marketingOptIn: true,
  notes: '',
})

function backupFilename(exportedAt: string) {
  const compactTimestamp = exportedAt.replace(/[:]/g, '-').replace(/[.].*/, '')
  return `prime-pianos-backup-${compactTimestamp}.json`
}

const emptyAppointmentForm = (): AppointmentInput => ({
  customerId: '',
  customerName: '',
  appointmentDate: '',
  quotedEstimate: 0,
  travelCharge: 0,
  additionalCharges: 0,
  additionalChargeNote: '',
  taxAmount: 0,
  paymentMethod: '',
  notes: '',
  status: 'scheduled',
})

function appointmentRecordToForm(appointment: AppointmentRecord): AppointmentInput {
  return {
    id: appointment.id,
    customerId: appointment.customerId,
    customerName: appointment.customerName,
    appointmentDate: toLocalAppointmentDateTime(appointment.appointmentDate),
    quotedEstimate: appointment.quotedEstimate,
    travelCharge: appointment.travelCharge,
    additionalCharges: appointment.additionalCharges,
    additionalChargeNote: appointment.additionalChargeNote,
    taxAmount: appointment.taxAmount,
    paymentMethod: appointment.paymentMethod,
    notes: appointment.notes,
    status: appointment.status,
  }
}

function currency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value || 0)
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`
}

function totalForAppointment(appointment: AppointmentRecord | AppointmentInput) {
  return (
    Number(appointment.quotedEstimate || 0) +
    Number(appointment.travelCharge || 0) +
    Number(appointment.additionalCharges || 0) +
    Number(appointment.taxAmount || 0)
  )
}

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function calculateIncludedTaxBreakdown(
  total: number,
  taxRate: number,
  travelCharge: number,
  additionalCharges: number,
) {
  const safeRate = Number.isFinite(taxRate) ? Math.max(taxRate, 0) : 0
  const divisor = 1 + safeRate
  const quotedEstimate = roundMoney(total / divisor - travelCharge - additionalCharges)
  const subtotal = roundMoney(quotedEstimate + travelCharge + additionalCharges)
  const taxAmount = roundMoney(total - subtotal)

  return {
    quotedEstimate,
    travelCharge,
    additionalCharges,
    taxAmount,
    total: roundMoney(total),
  }
}

function buildAdditionalChargeNote(
  pitchRaiseIncluded: boolean,
  voicingIncluded: boolean,
  repairsAmount: number,
) {
  const parts: string[] = []
  if (pitchRaiseIncluded) {
    parts.push('Pitch raise')
  }
  if (voicingIncluded) {
    parts.push('Voicing')
  }
  if (repairsAmount > 0) {
    parts.push('Repairs')
  }
  return parts.join(' + ')
}

function additionalChargeBreakdown(
  additionalCharges: number,
  additionalChargeNote: string,
  settings: BusinessSettings,
) {
  const total = roundMoney(Number(additionalCharges || 0))
  const normalizedNote = additionalChargeNote.trim().toLowerCase()
  const hasPitchRaise =
    normalizedNote.includes('pitch raise') || normalizedNote.includes('pitch change')
  const hasVoicing = normalizedNote.includes('voicing')
  const hasRepairs = normalizedNote.includes('repair')
  const pitchRaiseCharge = hasPitchRaise ? Math.min(settings.defaultPitchRaiseCharge, total) : 0
  const afterPitchRaise = roundMoney(Math.max(total - pitchRaiseCharge, 0))
  const voicingCharge = hasVoicing ? Math.min(settings.defaultVoicingCharge, afterPitchRaise) : 0
  const remainder = roundMoney(Math.max(afterPitchRaise - voicingCharge, 0))
  const repairsCharge = hasRepairs ? remainder : 0
  const genericAdditionalCharges =
    hasRepairs ? 0
    : hasPitchRaise || hasVoicing ? remainder
    : total

  return {
    pitchRaiseCharge,
    voicingCharge,
    repairsCharge,
    genericAdditionalCharges,
  }
}

function appointmentChargeDetails(
  appointment: AppointmentRecord | AppointmentInput,
  settings: BusinessSettings,
) {
  const breakdown = additionalChargeBreakdown(
    appointment.additionalCharges,
    appointment.additionalChargeNote,
    settings,
  )
  const generatedNote = buildAdditionalChargeNote(
    breakdown.pitchRaiseCharge > 0,
    breakdown.voicingCharge > 0,
    breakdown.repairsCharge,
  )
  const showCustomNote =
    appointment.additionalChargeNote.trim().length > 0 &&
    appointment.additionalChargeNote.trim() !== generatedNote

  return [
    { label: 'Quoted estimate', value: currency(appointment.quotedEstimate) },
    { label: 'Travel charge', value: currency(appointment.travelCharge) },
    ...(breakdown.pitchRaiseCharge > 0
      ? [{ label: 'Pitch raise', value: currency(breakdown.pitchRaiseCharge) }]
      : []),
    ...(breakdown.voicingCharge > 0
      ? [{ label: 'Voicing', value: currency(breakdown.voicingCharge) }]
      : []),
    ...(breakdown.repairsCharge > 0
      ? [{ label: 'Repairs', value: currency(breakdown.repairsCharge) }]
      : []),
    ...(breakdown.genericAdditionalCharges > 0
      ? [{ label: 'Additional charges', value: currency(breakdown.genericAdditionalCharges) }]
      : []),
    ...(showCustomNote
      ? [{ label: 'Additional charge note', value: appointment.additionalChargeNote }]
      : []),
    { label: 'Tax', value: currency(appointment.taxAmount) },
    { label: 'Total', value: currency(totalForAppointment(appointment)) },
  ]
}

function fullDate(value: string) {
  return format(parseISO(value), 'MMM d, yyyy h:mm a')
}

function shortDate(value: string) {
  return format(parseISO(value), 'MMM d, yyyy')
}

function shortDateTime(value: string) {
  return format(parseISO(value), 'MMM d h:mm a')
}

function paymentMethodLabel(value: PaymentMethod) {
  switch (value) {
    case 'cash':
      return 'Cash'
    case 'check':
      return 'Check'
    case 'venmo':
      return 'Venmo'
    default:
      return 'Not recorded'
  }
}

function communicationKindLabel(value: CommunicationLogRecord['kind']) {
  switch (value) {
    case 'appointment_confirmation':
      return 'Appointment confirmation'
    case 'appointment_reminder':
      return 'Appointment reminder'
    case 'follow_up':
      return 'Follow-up'
    case 'marketing':
      return 'Marketing'
    case 'reminder':
      return 'Reminder'
    case 'invoice':
    default:
      return 'Invoice'
  }
}

function communicationChannelLabel(value: CommunicationLogRecord['channel']) {
  return value === 'sms' ? 'Text' : 'Email'
}

function contactPreferenceLabel(value: CustomerRecord['contactPreference']) {
  switch (value) {
    case 'email':
      return 'Email'
    case 'sms':
      return 'Text'
    default:
      return 'No preference'
  }
}

function communicationPreview(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function customerAllowedChannels(customer: CustomerRecord): CommunicationChannel[] {
  if (customer.contactPreference === 'email') {
    return customer.email ? ['email'] : []
  }

  if (customer.contactPreference === 'sms') {
    return customer.phone ? ['sms'] : []
  }

  const channels: CommunicationChannel[] = []
  if (customer.email) {
    channels.push('email')
  }
  if (customer.phone) {
    channels.push('sms')
  }
  return channels
}

function customerCanUseChannel(customer: CustomerRecord, channel: CommunicationChannel) {
  return customerAllowedChannels(customer).includes(channel)
}

function calendarEventClass(status: AppointmentStatus) {
  return `calendar-event status-${status}`
}

function parseAppointmentDateTime(value: string) {
  const [datePart = '', timePart = '10:00'] = value.split('T')
  const [rawHour = '10', rawMinute = '00'] = timePart.split(':')
  const hour24 = Number(rawHour)
  const minute = Number(rawMinute)

  return {
    datePart,
    hour24: Number.isNaN(hour24) ? 10 : hour24,
    minute: Number.isNaN(minute) ? 0 : minute,
  }
}

function buildAppointmentDateTime(datePart: string, hour24: number, minute: number) {
  const safeHour = String(hour24).padStart(2, '0')
  const safeMinute = String(minute).padStart(2, '0')
  return `${datePart}T${safeHour}:${safeMinute}`
}

function toLocalAppointmentDateTime(value: string) {
  try {
    return format(parseISO(value), "yyyy-MM-dd'T'HH:mm")
  } catch {
    return value.slice(0, 16)
  }
}

function referralSourceLabel(value: CustomerRecord['referralSource']) {
  switch (value) {
    case 'google_search':
      return 'Google search'
    case 'business_card_at_store':
      return 'Business card at store'
    case 'friend_family':
      return 'Friend/family'
    case 'social_media':
      return 'Social media'
    case 'other':
      return 'Other'
    default:
      return 'Not recorded'
  }
}

const referralSourceOrder: Array<Exclude<CustomerRecord['referralSource'], ''>> = [
  'google_search',
  'business_card_at_store',
  'friend_family',
  'social_media',
  'other',
]

const referralSourceColors: Record<Exclude<CustomerRecord['referralSource'], ''>, string> = {
  google_search: '#214c3c',
  business_card_at_store: '#7d5e35',
  friend_family: '#c77f2f',
  social_media: '#6b8e5f',
  other: '#8a6d8f',
}

function pieChartSegmentPath(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) {
  const startRadians = (startAngle - 90) * (Math.PI / 180)
  const endRadians = (endAngle - 90) * (Math.PI / 180)
  const x1 = centerX + radius * Math.cos(startRadians)
  const y1 = centerY + radius * Math.sin(startRadians)
  const x2 = centerX + radius * Math.cos(endRadians)
  const y2 = centerY + radius * Math.sin(endRadians)
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0

  return `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`
}

function formatHourOption(hour24: number) {
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 || 12
  return `${hour12} ${period}`
}

function mapLink(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

function quartersFromAppointments(appointments: AppointmentRecord[]) {
  const now = new Date()
  return Array.from({ length: 6 }, (_, index) => {
    const cursor = subQuarters(now, index)
    const start = startOfQuarter(cursor)
    const end = endOfQuarter(cursor)
    const items = appointments.filter((appointment) => {
      const date = parseISO(appointment.appointmentDate)
      return appointment.status !== 'scheduled' && !isBefore(date, start) && !isAfter(date, end)
    })

    return {
      label: `Q${Math.floor(start.getMonth() / 3) + 1} ${format(start, 'yyyy')}`,
      sales: items.reduce(
        (sum, item) =>
          sum + item.quotedEstimate + item.travelCharge + item.additionalCharges,
        0,
      ),
      tax: items.reduce((sum, item) => sum + item.taxAmount, 0),
      count: items.length,
    }
  })
}

function StatCard({
  label,
  value,
  detail,
  action,
}: {
  label: string
  value: string
  detail: string
  action?: React.ReactNode
}) {
  return (
    <article className="stat-card">
      <div className="stat-card-header">
        <span>{label}</span>
        {action ? <div className="stat-card-action">{action}</div> : null}
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

type MessageComposerState = {
  appointmentId?: string
  channel: CommunicationChannel
  customerId?: string
  headerDetails?: Array<{ label: string; value: string }>
  kind: CommunicationKind
  message: string
  recipient: string
  statusMessage: string
  subject: string
  title: string
}

type AppointmentChannelPromptState = {
  appointment: AppointmentRecord
  customer: CustomerRecord
  kind: 'appointment_confirmation'
}

type ReportPeriod = 'week' | 'month' | 'quarter' | 'year' | 'all'

type MarkPaidState = {
  appointmentId: string
  paymentMethod: PaymentMethod
}

type ConfirmDialogState =
  | {
      title: string
      message: string
      action:
        | { type: 'delete_customer'; customerId: string }
        | { type: 'delete_appointment'; appointmentId: string }
        | { type: 'cancel_followup'; appointmentId: string }
    }

function App() {
  const appVersion = __APP_VERSION__
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('month')
  const [selectedQuarterLabel, setSelectedQuarterLabel] = useState('')
  const [user, setUser] = useState(() => getCurrentUser())
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([])
  const [communicationLogs, setCommunicationLogs] = useState<CommunicationLogRecord[]>([])
  const [settings, setSettings] = useState<BusinessSettings>(defaultSettings)
  const [customerForm, setCustomerForm] = useState<CustomerInput>(emptyCustomerForm(defaultSettings))
  const [appointmentForm, setAppointmentForm] = useState<AppointmentInput>(emptyAppointmentForm())
  const [activeTab, setActiveTab] = useState<LegacyTabKey>('customers')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()))
  const [isCustomerFormOpen, setIsCustomerFormOpen] = useState(false)
  const [isAppointmentFormOpen, setIsAppointmentFormOpen] = useState(false)
  const [isAppointmentEditing, setIsAppointmentEditing] = useState(false)
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('')
  const [customerDetailOrigin, setCustomerDetailOrigin] = useState<DetailOrigin>(
    defaultCustomerDetailOrigin,
  )
  const [appointmentDetailOrigin, setAppointmentDetailOrigin] = useState<DetailOrigin>(
    defaultAppointmentDetailOrigin,
  )
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [filters, setFilters] = useState({
    customerSearch: '',
    serviceHistorySearch: '',
    communicationSearch: '',
    serviceWindowMonths: defaultSettings.marketingExcludeMonths,
  })
  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState('Ready.')
  const [errorText, setErrorText] = useState('')
  const [messageComposer, setMessageComposer] = useState<MessageComposerState | null>(null)
  const [appointmentChannelPrompt, setAppointmentChannelPrompt] =
    useState<AppointmentChannelPromptState | null>(null)
  const [markPaidState, setMarkPaidState] = useState<MarkPaidState | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [appointmentPricingOptions, setAppointmentPricingOptions] = useState({
    travelIncluded: false,
    pitchRaiseIncluded: false,
    voicingIncluded: false,
    repairsAmount: 0,
  })
  const repairAmountOptions = Array.from(
    new Set([...REPAIR_AMOUNT_OPTIONS, appointmentPricingOptions.repairsAmount]),
  ).sort((left, right) => left - right)

  const refreshData = useEffectEvent(async () => {
    const [nextCustomers, nextAppointments, nextCommunicationLogs, nextSettings] = await Promise.all([
      fetchCustomers(),
      fetchAppointments(),
      fetchCommunicationLogs(),
      fetchSettings(),
    ])

    setCustomers(nextCustomers)
    setAppointments(nextAppointments)
    setCommunicationLogs(nextCommunicationLogs)
    setSettings(nextSettings)
    setCustomerForm((current) =>
      current.id ? current : emptyCustomerForm(nextSettings),
    )
    setFilters((current) => ({
      ...current,
      serviceWindowMonths: nextSettings.marketingExcludeMonths,
    }))
  })

  useEffect(() => {
    if (!user || !isParseConfigured()) {
      return
    }

    setLoading(true)
    setErrorText('')
    refreshData()
      .then(() => setStatusText('Data synced from Back4App.'))
      .catch((error: Error) => setErrorText(error.message))
      .finally(() => setLoading(false))
  }, [user])

  const customerMap = new Map(customers.map((customer) => [customer.id, customer]))
  const selectedCustomer =
    customers.find((customer) => customer.id === selectedCustomerId) ?? null
  const selectedAppointment =
    appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null

  const customerAppointments = (customerId: string) =>
    appointments
      .filter((appointment) => appointment.customerId === customerId)
      .sort((left, right) => right.appointmentDate.localeCompare(left.appointmentDate))

  const lastServiceForCustomer = (customerId: string) =>
    customerAppointments(customerId).find((appointment) => appointment.status !== 'scheduled') ?? null

  const reminderQueue = customers
    .map((customer) => {
      const lastService = lastServiceForCustomer(customer.id)
      if (!lastService || !customer.reminderOptIn) {
        return null
      }

      const dueDate = addMonths(parseISO(lastService.appointmentDate), customer.reminderMonths)
      return {
        customer,
        lastService,
        dueDate,
        isDue: dueDate <= new Date(),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.isDue)
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())

  const followUpQueue = appointments
    .map((appointment) => {
      if (
        appointment.status === 'scheduled' ||
        appointment.followUpSentAt ||
        appointment.followUpCancelledAt
      ) {
        return null
      }

      const customer = customerMap.get(appointment.customerId)
      if (!customer) {
        return null
      }

      const dueDate = addWeeks(
        parseISO(appointment.appointmentDate),
        customer.followUpWeeks || settings.defaultFollowUpWeeks,
      )

      return {
        appointment,
        customer,
        dueDate,
        isDue: dueDate <= new Date(),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.isDue)
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())

  const upcomingAppointmentQueue = appointments
    .filter((appointment) => appointment.status === 'scheduled')
    .map((appointment) => {
      const customer = customerMap.get(appointment.customerId)
      if (!customer) {
        return null
      }

      const appointmentDate = parseISO(appointment.appointmentDate)
      return {
        appointment,
        customer,
        isUpcoming: !isBefore(appointmentDate, new Date()) && !isAfter(appointmentDate, addDays(new Date(), 7)),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.isUpcoming)
    .sort((left, right) => left.appointment.appointmentDate.localeCompare(right.appointment.appointmentDate))

  const latestAppointmentReminderByAppointmentId = communicationLogs
    .filter((item) => item.kind === 'appointment_reminder' && item.appointmentId)
    .reduce<Map<string, CommunicationLogRecord>>((map, item) => {
      const existing = map.get(item.appointmentId)
      if (!existing || existing.createdAt < item.createdAt) {
        map.set(item.appointmentId, item)
      }
      return map
    }, new Map())

  const marketingTargets = customers
    .filter((customer) => customer.marketingOptIn)
    .filter((customer) => {
      const lastService = lastServiceForCustomer(customer.id)
      if (!lastService) {
        return true
      }

      return parseISO(lastService.appointmentDate) < subMonths(new Date(), filters.serviceWindowMonths)
    })
    .sort((left, right) => left.name.localeCompare(right.name))

  const filteredCustomers = customers.filter((customer) => {
    const query = filters.customerSearch.trim().toLowerCase()
    if (!query) {
      return true
    }

    return [customer.name, customer.email, customer.phone, customer.address].some((field) =>
      field.toLowerCase().includes(query),
    )
  })
  const selectedVisibleCustomer =
    filteredCustomers.find((customer) => customer.id === selectedCustomerId) ??
    null
  const isCustomerDirectoryView =
    activeTab === 'customers' && !isCustomerFormOpen && !selectedVisibleCustomer

  useEffect(() => {
    if (!isCustomerDirectoryView) {
      document.body.classList.remove('customer-list-page-body')
      return
    }

    document.body.classList.add('customer-list-page-body')

    return () => {
      document.body.classList.remove('customer-list-page-body')
    }
  }, [isCustomerDirectoryView])

  const quarterSummary = quartersFromAppointments(appointments)
  const invoiceReadyAppointments = appointments.filter(
    (appointment) => appointment.status !== 'scheduled',
  )
  const invoiceQueueAppointments = invoiceReadyAppointments
  const outstandingInvoices = invoiceReadyAppointments.filter(
    (appointment) => appointment.status !== 'paid',
  )
  const uninvoicedAppointments = invoiceReadyAppointments
    .filter((appointment) => !appointment.invoiceSentAt && appointment.status !== 'paid')
    .sort((left, right) => left.appointmentDate.localeCompare(right.appointmentDate))
  const unpaidAppointments = invoiceReadyAppointments
    .filter(
      (appointment) =>
        appointment.status !== 'paid' &&
        Boolean(appointment.invoiceSentAt || appointment.status === 'invoiced'),
    )
    .sort((left, right) => left.appointmentDate.localeCompare(right.appointmentDate))
  const recentlyPaidAppointments = appointments
    .filter((appointment) => {
      if (appointment.status !== 'paid') {
        return false
      }

      return !isBefore(parseISO(appointment.updatedAt), subDays(new Date(), 14))
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const completedAppointments = appointments.filter(
    (appointment) => appointment.status !== 'scheduled',
  )
  const serviceHistoryAppointments = [...completedAppointments].sort((left, right) =>
    right.appointmentDate.localeCompare(left.appointmentDate),
  )
  const filteredServiceHistoryAppointments = serviceHistoryAppointments.filter((appointment) => {
    const query = filters.serviceHistorySearch.trim().toLowerCase()
    if (!query) {
      return true
    }

    return [
      appointment.customerName,
      appointment.status,
      appointment.notes,
      fullDate(appointment.appointmentDate),
      shortDate(appointment.appointmentDate),
      currency(totalForAppointment(appointment)),
    ].some((field) => field.toLowerCase().includes(query))
  })
  const filteredCommunicationLogs = communicationLogs.filter((item) => {
    const query = filters.communicationSearch.trim().toLowerCase()
    if (!query) {
      return true
    }

    const customerName = customerMap.get(item.customerId)?.name ?? ''
    const appointment = appointments.find((candidate) => candidate.id === item.appointmentId)

    return [
      customerName,
      item.recipient,
      item.subject,
      item.body,
      communicationKindLabel(item.kind),
      communicationChannelLabel(item.channel),
      item.provider,
      appointment?.customerName ?? '',
      item.createdAt ? fullDate(item.createdAt) : '',
    ].some((field) => field.toLowerCase().includes(query))
  })

  function renderInvoiceQueue(
    list: AppointmentRecord[],
    emptyText: string,
    metaText: (appointment: AppointmentRecord) => string,
    options?: {
      showCommunicationActions?: boolean
    },
  ) {
    const showCommunicationActions = options?.showCommunicationActions ?? true

    return (
      <div className="queue-list">
        {list.map((appointment) => {
          const customer = customerMap.get(appointment.customerId)
          if (!customer) {
            return null
          }
          const meta = metaText(appointment)
          const [metaLeading, metaTrailing] = meta.split(' • ', 2)

          return (
            <div key={appointment.id} className="queue-card invoice-queue-card">
              <div>
                <button
                  type="button"
                  className="inline-link-button workflow-name-link"
                  onClick={() => openCustomerDetails(customer.id, detailOrigin('invoices', 'invoicing'))}
                >
                  {appointment.customerName}
                </button>
                <span>{currency(totalForAppointment(appointment))}</span>
                <div className="invoice-meta">
                  <span>{metaLeading}</span>
                  {metaTrailing ? <span className="invoice-meta-secondary">{metaTrailing}</span> : null}
                </div>
              </div>
              <div className="workflow-action-stack">
                {showCommunicationActions ? (
                  <div className="workflow-action-row workflow-action-row-primary">
                    {customerCanUseChannel(customer, 'email') ? (
                      <button
                        className="secondary-button"
                        onClick={() => openInvoiceComposer('email', customer, appointment)}
                      >
                        Email
                      </button>
                    ) : null}
                    {customerCanUseChannel(customer, 'sms') ? (
                      <button
                        className="secondary-button"
                        onClick={() => openInvoiceComposer('sms', customer, appointment)}
                      >
                        Text
                      </button>
                    ) : null}
                    <button
                      className="secondary-button"
                      onClick={() =>
                        copyText(invoiceText(appointment), 'Invoice text copied to clipboard.')
                      }
                    >
                      Copy
                    </button>
                  </div>
                ) : null}
                <div className="workflow-action-row workflow-action-row-secondary">
                  <button
                    className="secondary-button"
                    onClick={() =>
                      openAppointmentDetails(appointment, detailOrigin('invoices', 'invoicing'))
                    }
                  >
                    Appt
                  </button>
                  {appointment.status !== 'paid' ? (
                    <button
                      className="secondary-button"
                      onClick={() => openMarkPaidModal(appointment)}
                    >
                      Mark paid
                    </button>
                  ) : (
                    <span className="paid-badge" aria-label="Appointment paid">
                      <span className="paid-badge-check" aria-hidden="true">
                        ✓
                      </span>
                      <span>Paid</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {list.length === 0 ? <p className="empty-state">{emptyText}</p> : null}
      </div>
    )
  }

  const reportRange = (() => {
    const now = new Date()
    switch (reportPeriod) {
      case 'all':
        return {
          label: 'All time',
          start: null,
          end: null,
        }
      case 'week':
        return {
          label: 'This week',
          start: startOfWeek(now, { weekStartsOn: 0 }),
          end: endOfWeek(now, { weekStartsOn: 0 }),
        }
      case 'quarter':
        return {
          label: 'This quarter',
          start: startOfQuarter(now),
          end: endOfQuarter(now),
        }
      case 'year':
        return {
          label: 'This year',
          start: startOfYear(now),
          end: endOfYear(now),
        }
      case 'month':
      default:
        return {
          label: 'This month',
          start: startOfMonth(now),
          end: endOfMonth(now),
        }
    }
  })()
  const recordedReferralCounts = referralSourceOrder
    .map((source) => ({
      key: source,
      label: referralSourceLabel(source),
      count: customers.filter((customer) => customer.referralSource === source).length,
      color: referralSourceColors[source],
    }))
    .filter((item) => item.count > 0)
  const unrecordedReferralCount = customers.filter((customer) => !customer.referralSource).length
  const totalRecordedReferralCount = recordedReferralCounts.reduce(
    (sum, item) => sum + item.count,
    0,
  )
  const periodAppointments =
    reportRange.start && reportRange.end
      ? completedAppointments.filter((appointment) => {
          const date = parseISO(appointment.appointmentDate)
          return !isBefore(date, reportRange.start) && !isAfter(date, reportRange.end)
        })
      : completedAppointments
  const periodSales = periodAppointments.reduce(
    (sum, appointment) =>
      sum + appointment.quotedEstimate + appointment.travelCharge + appointment.additionalCharges,
    0,
  )
  const periodTaxCollected = periodAppointments.reduce(
    (sum, appointment) => sum + appointment.taxAmount,
    0,
  )
  const activeQuarterLabel = quarterSummary.some((quarter) => quarter.label === selectedQuarterLabel)
    ? selectedQuarterLabel
    : (quarterSummary[0]?.label ?? '')
  const selectedQuarter =
    quarterSummary.find((quarter) => quarter.label === activeQuarterLabel) ??
    quarterSummary[0] ??
    null
  const sortedAppointments = [...appointments].sort((left, right) =>
    left.appointmentDate.localeCompare(right.appointmentDate),
  )
  const appointmentTimeParts = parseAppointmentDateTime(appointmentForm.appointmentDate)
  const appointmentHourOptions = Array.from({ length: 14 }, (_, index) => 7 + index)
  const appointmentMinuteOptions = [0, 15, 30, 45]
  const today = new Date()
  const nextTwoWeeksAppointments = sortedAppointments.filter((appointment) => {
    const date = parseISO(appointment.appointmentDate)
    return !isBefore(date, today) && !isAfter(date, addDays(today, 14))
  })
  const calendarStart = startOfWeek(startOfMonth(calendarMonth), { weekStartsOn: 0 })
  const calendarEnd = endOfWeek(endOfMonth(calendarMonth), { weekStartsOn: 0 })
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  const appointmentsByDay = sortedAppointments.reduce<Record<string, AppointmentRecord[]>>(
    (grouped, appointment) => {
      const key = format(parseISO(appointment.appointmentDate), 'yyyy-MM-dd')
      grouped[key] ??= []
      grouped[key].push(appointment)
      return grouped
    },
    {},
  )

  useEffect(() => {
    if (selectedCustomerId && !selectedVisibleCustomer) {
      setSelectedCustomerId('')
    }
  }, [selectedCustomerId, selectedVisibleCustomer])

  useEffect(() => {
    if (!quarterSummary.length) {
      setSelectedQuarterLabel('')
      return
    }

    if (!quarterSummary.some((quarter) => quarter.label === selectedQuarterLabel)) {
      setSelectedQuarterLabel(quarterSummary[0].label)
    }
  }, [quarterSummary, selectedQuarterLabel])

  async function runTask<T>(message: string, task: () => Promise<T>) {
    setLoading(true)
    setErrorText('')
    setStatusText(message)

    try {
      const result = await task()
      return result
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unexpected error.')
      return null
    } finally {
      setLoading(false)
    }
  }
  async function handleBackupDownload() {
    const backup = await runTask('Preparing backup export...', () => createAppBackup())
    if (!backup) {
      return
    }

    const json = JSON.stringify(backup, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = backupFilename(backup.exportedAt)
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setStatusText(`Backup downloaded: ${backupFilename(backup.exportedAt)}`)
  }

  function openMessageComposer(input: MessageComposerState) {
    setErrorText('')
    setMessageComposer(input)
  }

  function openCustomerDetails(
    customerId: string,
    origin: DetailOrigin = defaultCustomerDetailOrigin,
  ) {
    setFilters((current) => ({ ...current, customerSearch: '' }))
    setIsCustomerFormOpen(false)
    setCustomerDetailOrigin(origin)
    setSelectedCustomerId(customerId)
    setActiveTab('customers')
  }

  function closeCustomerDetails() {
    setSelectedCustomerId('')
    setActiveTab(customerDetailOrigin.tab)
    setCustomerDetailOrigin(defaultCustomerDetailOrigin)
  }

  function openCustomerDetailsFromWorkflow(customerId: string) {
    openCustomerDetails(customerId, detailOrigin('followups', 'follow-ups'))
  }

  function openMarkPaidModal(appointment: AppointmentRecord) {
    setErrorText('')
    setMarkPaidState({
      appointmentId: appointment.id,
      paymentMethod: appointment.paymentMethod || 'cash',
    })
  }

  function openInvoiceComposer(channel: CommunicationChannel, customer: CustomerRecord, appointment: AppointmentRecord) {
    openMessageComposer({
      channel,
      customerId: customer.id,
      appointmentId: appointment.id,
      headerDetails: invoiceComposerDetails(customer, appointment),
      kind: 'invoice',
      recipient: channel === 'email' ? customer.email : customer.phone,
      subject: `Invoice from ${settings.businessName}`,
      message: channel === 'email' ? invoiceEmailText(appointment) : invoiceText(appointment),
      title: channel === 'email' ? 'Invoice' : 'Invoice text',
      statusMessage: `Invoice ${channel === 'email' ? 'email' : 'text'} sent to ${customer.name}.`,
    })
  }

  function openRecurringReminderComposer(
    channel: CommunicationChannel,
    customer: CustomerRecord,
    appointment: AppointmentRecord,
  ) {
    openMessageComposer({
      channel,
      customerId: customer.id,
      appointmentId: appointment.id,
      kind: 'reminder',
      recipient: channel === 'email' ? customer.email : customer.phone,
      subject: 'Time to schedule your next piano tuning',
      message:
        channel === 'email'
          ? reminderEmailText(customer, appointment)
          : reminderSmsText(customer, appointment),
      title: channel === 'email' ? 'Time for your next tuning' : 'Reminder text',
      statusMessage: `Reminder ${channel === 'email' ? 'email' : 'text'} sent to ${customer.name}.`,
    })
  }

  function openFollowUpComposer(
    channel: CommunicationChannel,
    customer: CustomerRecord,
    appointment: AppointmentRecord,
  ) {
    openMessageComposer({
      channel,
      customerId: customer.id,
      appointmentId: appointment.id,
      kind: 'follow_up',
      recipient: channel === 'email' ? customer.email : customer.phone,
      subject: 'Checking in on your piano',
      message: followUpText(customer, appointment),
      title: channel === 'email' ? 'Checking in after your tuning' : 'Follow-up text',
      statusMessage: `Follow-up ${channel === 'email' ? 'email' : 'text'} sent to ${customer.name}.`,
    })
  }

  function openNativeSmsComposer(recipient: string, message: string) {
    const to = recipient.trim()
    if (!to) {
      throw new Error('A phone number is required to open the messaging app.')
    }

    const smsUrl = `sms:${encodeURIComponent(to)}?&body=${encodeURIComponent(message)}`
    window.location.href = smsUrl
  }

  function openAppointmentConfirmationComposer(
    channel: CommunicationChannel,
    customer: CustomerRecord,
    appointment: AppointmentRecord,
  ) {
    openMessageComposer({
      channel,
      customerId: customer.id,
      appointmentId: appointment.id,
      headerDetails: appointmentCommunicationDetails(customer, appointment),
      kind: 'appointment_confirmation',
      recipient: channel === 'email' ? customer.email : customer.phone,
      subject: `Appointment confirmation from ${settings.businessName}`,
      message:
        channel === 'email'
          ? appointmentConfirmationText(customer)
          : appointmentConfirmationSms(customer, appointment),
      title: channel === 'email' ? 'Appointment confirmation' : 'Confirmation text',
      statusMessage: `Appointment confirmation ${channel === 'email' ? 'email' : 'text'} sent to ${customer.name}.`,
    })
  }

  function openUpcomingAppointmentReminderComposer(
    channel: CommunicationChannel,
    customer: CustomerRecord,
    appointment: AppointmentRecord,
  ) {
    openMessageComposer({
      channel,
      customerId: customer.id,
      appointmentId: appointment.id,
      headerDetails: appointmentCommunicationDetails(customer, appointment),
      kind: 'appointment_reminder',
      recipient: channel === 'email' ? customer.email : customer.phone,
      subject: `Appointment reminder from ${settings.businessName}`,
      message:
        channel === 'email'
          ? appointmentReminderText(customer)
          : appointmentReminderSms(customer, appointment),
      title: channel === 'email' ? 'Appointment reminder' : 'Reminder text',
      statusMessage: `Appointment reminder ${channel === 'email' ? 'email' : 'text'} sent to ${customer.name}.`,
    })
  }

  function promptAppointmentConfirmation(customer: CustomerRecord, appointment: AppointmentRecord) {
    const channels = customerAllowedChannels(customer)

    if (channels.length === 0) {
      setStatusText(`Saved appointment for ${customer.name}.`)
      return
    }

    if (channels.length === 1) {
      openAppointmentConfirmationComposer(channels[0], customer, appointment)
      return
    }

    setAppointmentChannelPrompt({
      appointment,
      customer,
      kind: 'appointment_confirmation',
    })
  }

  async function handleComposerSend() {
    if (!messageComposer) {
      return
    }

    const updated = await runTask(
      `Sending ${messageComposer.channel === 'email' ? 'email' : 'text'}…`,
      async () => {
        if (messageComposer.channel === 'email') {
          const composerAppointment = messageComposer.appointmentId
            ? appointments.find((appointment) => appointment.id === messageComposer.appointmentId) ?? null
            : null
          const composerCustomer = messageComposer.customerId
            ? customerMap.get(messageComposer.customerId) ?? null
            : null

          let html = proseEmailHtml(messageComposer.message, {
            eyebrow: settings.businessName,
            title: messageComposer.title,
          })

          if (messageComposer.kind === 'invoice' && composerAppointment) {
            html = invoiceHtml(composerAppointment, messageComposer.message)
          }

          if (
            messageComposer.kind === 'appointment_confirmation' &&
            composerCustomer &&
            composerAppointment
          ) {
            html = appointmentConfirmationHtml(
              composerCustomer,
              composerAppointment,
              messageComposer.message,
            )
          }

          if (
            messageComposer.kind === 'appointment_reminder' &&
            composerCustomer &&
            composerAppointment
          ) {
            html = appointmentReminderHtml(
              composerCustomer,
              composerAppointment,
              messageComposer.message,
            )
          }

          if (messageComposer.kind === 'reminder' && composerCustomer && composerAppointment) {
            html = reminderHtml(composerCustomer, composerAppointment, messageComposer.message)
          }

          if (messageComposer.kind === 'follow_up' && composerCustomer && composerAppointment) {
            html = followUpHtml(composerCustomer, composerAppointment, messageComposer.message)
          }

          if (messageComposer.kind === 'marketing') {
            html = marketingHtml(messageComposer.message)
          }

          if (messageComposer.kind === 'marketing') {
            const recipients = messageComposer.recipient
              .split(/[\n,;]+/)
              .map((value) => value.trim())
              .filter(Boolean)

            await sendMarketingBlast({
              to: recipients,
              subject: messageComposer.subject,
              text: messageComposer.message,
              html,
              customerIds: marketingTargets.map((customer) => customer.id),
            })
          } else {
            await sendBusinessEmail({
              to: messageComposer.recipient,
              subject: messageComposer.subject,
              text: messageComposer.message,
              html,
              customerId: messageComposer.customerId,
              appointmentId: messageComposer.appointmentId,
              kind: messageComposer.kind,
            })
          }
        } else {
          if (messageComposer.kind === 'marketing') {
            throw new Error('Marketing blasts can only be sent by email.')
          }

          if (messageComposer.kind === 'follow_up') {
            openNativeSmsComposer(messageComposer.recipient, messageComposer.message)
            await saveManualCommunicationLog({
              channel: 'sms',
              provider: 'device_sms',
              kind: messageComposer.kind,
              recipient: messageComposer.recipient,
              body: messageComposer.message,
              customerId: messageComposer.customerId,
              appointmentId: messageComposer.appointmentId,
            })
          } else {
            await sendBusinessSms({
              to: messageComposer.recipient,
              body: messageComposer.message,
              customerId: messageComposer.customerId,
              appointmentId: messageComposer.appointmentId,
              kind: messageComposer.kind,
            })
          }
        }

        if (messageComposer.kind === 'invoice' && messageComposer.appointmentId) {
          await markInvoiceSent(messageComposer.appointmentId)
        }

        if (messageComposer.kind === 'reminder' && messageComposer.customerId) {
          await markReminderSent(messageComposer.customerId)
        }

        if (messageComposer.kind === 'follow_up' && messageComposer.appointmentId) {
          await markFollowUpSent(messageComposer.appointmentId)
        }

        if (messageComposer.kind === 'marketing') {
          await markMarketingSent(marketingTargets.map((customer) => customer.id))
        }

        return true
      },
    )

    if (updated) {
      await refreshData()
      setMessageComposer(null)
      setStatusText(messageComposer.statusMessage)
    }
  }

  async function handleMarkPaid() {
    if (!markPaidState) {
      return
    }

    const appointment = appointments.find((item) => item.id === markPaidState.appointmentId)
    if (!appointment) {
      setErrorText('That appointment could not be found.')
      return
    }

    if (!markPaidState.paymentMethod) {
      setErrorText('Choose a payment method before marking the appointment paid.')
      return
    }

    const saved = await runTask('Marking appointment paid…', () =>
      saveAppointment({
        id: appointment.id,
        customerId: appointment.customerId,
        customerName: appointment.customerName,
        appointmentDate: toLocalAppointmentDateTime(appointment.appointmentDate),
        quotedEstimate: appointment.quotedEstimate,
        travelCharge: appointment.travelCharge,
        additionalCharges: appointment.additionalCharges,
        additionalChargeNote: appointment.additionalChargeNote,
        taxAmount: appointment.taxAmount,
        paymentMethod: markPaidState.paymentMethod,
        notes: appointment.notes,
        status: 'paid',
      }),
    )

    if (saved) {
      await refreshData()
      setMarkPaidState(null)
      setStatusText(`Marked ${appointment.customerName}'s appointment as paid.`)
    }
  }

  async function handleCancelFollowUp(appointment: AppointmentRecord) {
    const confirmed = globalThis.confirm(
      `Remove the follow-up reminder for ${appointment.customerName} on ${shortDate(appointment.appointmentDate)}?`,
    )

    if (!confirmed) {
      return
    }

    const saved = await runTask('Cancelling follow-up…', () => cancelFollowUp(appointment.id))
    if (saved) {
      await refreshData()
      setStatusText(`Cancelled the follow-up reminder for ${appointment.customerName}.`)
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const result = await runTask('Signing in…', () =>
      login(loginForm.username.trim(), loginForm.password),
    )
    if (result) {
      setUser(result)
      setLoginForm({ username: '', password: '' })
      setStatusText(`Signed in as ${result.getUsername()}.`)
    }
  }

  async function handleLogout() {
    const result = await runTask('Signing out…', () => logout())
    if (result !== null) {
      setUser(null)
      setCustomers([])
      setAppointments([])
      setStatusText('Signed out.')
    }
  }

  async function handleCustomerSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await runTask('Saving customer…', () => saveCustomer(customerForm))
    if (saved) {
      await refreshData()
      setCustomerForm(emptyCustomerForm(settings))
      setSelectedCustomerId(saved.id)
      setIsCustomerFormOpen(false)
      setStatusText(`Saved ${saved.name}.`)
    }
  }

  async function handleAppointmentSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const selected = customerMap.get(appointmentForm.customerId)
    if (!selected) {
      setErrorText('Choose a customer before saving the appointment.')
      return
    }
    if (!parseAppointmentDateTime(appointmentForm.appointmentDate).datePart) {
      setErrorText('Choose an appointment date before saving the appointment.')
      return
    }
    const isNewAppointment = !appointmentForm.id

    const payload: AppointmentInput = {
      ...appointmentForm,
      customerName: selected.name,
    }

    const saved = await runTask('Saving appointment…', () => saveAppointment(payload))
    if (saved) {
      await refreshData()
      setAppointmentForm(appointmentRecordToForm(saved))
      setSelectedAppointmentId(saved.id)
      setIsAppointmentFormOpen(true)
      setIsAppointmentEditing(false)
      setSelectedCustomerId(selected.id)
      if (isNewAppointment) {
        promptAppointmentConfirmation(selected, saved)
      } else {
        setStatusText(`Saved appointment for ${selected.name}.`)
      }
    }
  }

  async function handleSettingsSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await runTask('Saving settings…', () => saveSettings(settings))
    if (saved) {
      setSettings(saved)
      setStatusText('Business settings updated.')
    }
  }

  async function handleDeleteCustomer(customerId: string) {
    const target = customerMap.get(customerId)
    if (!target || !window.confirm(`Delete ${target.name} and all linked appointments?`)) {
      return
    }

    const removed = await runTask('Deleting customer…', () => deleteCustomer(customerId))
    if (removed !== null) {
      await refreshData()
      setSelectedCustomerId('')
      setStatusText(`Deleted ${target.name}.`)
    }
  }

  async function handleDeleteAppointment(appointmentId: string) {
    if (!window.confirm('Delete this appointment?')) {
      return
    }

    const removed = await runTask('Deleting appointment…', () =>
      deleteAppointment(appointmentId),
    )
    if (removed !== null) {
      await refreshData()
      setStatusText('Appointment deleted.')
    }
  }

  void handleCancelFollowUp
  void handleDeleteCustomer
  void handleDeleteAppointment

  function queueDeleteCustomerConfirmation(customerId: string) {
    const target = customerMap.get(customerId)
    if (!target) {
      return
    }

    setConfirmDialog({
      title: 'Delete customer',
      message: `Delete ${target.name} and all linked appointments?`,
      action: { type: 'delete_customer', customerId },
    })
  }

  function queueDeleteAppointmentConfirmation(appointmentId: string) {
    setConfirmDialog({
      title: 'Delete appointment',
      message: 'Delete this appointment?',
      action: { type: 'delete_appointment', appointmentId },
    })
  }

  function queueCancelFollowUpConfirmation(appointment: AppointmentRecord) {
    setConfirmDialog({
      title: 'Cancel follow-up reminder',
      message: `Remove the follow-up reminder for ${appointment.customerName} on ${shortDate(appointment.appointmentDate)}?`,
      action: { type: 'cancel_followup', appointmentId: appointment.id },
    })
  }

  async function handleConfirmDialogYes() {
    if (!confirmDialog) {
      return
    }

    const action = confirmDialog.action
    setConfirmDialog(null)

    if (action.type === 'delete_customer') {
      const target = customerMap.get(action.customerId)
      if (!target) {
        return
      }

      const removed = await runTask('Deleting customerâ€¦', () => deleteCustomer(action.customerId))
      if (removed !== null) {
        await refreshData()
        setSelectedCustomerId('')
        setStatusText(`Deleted ${target.name}.`)
      }
      return
    }

    if (action.type === 'delete_appointment') {
      const removed = await runTask('Deleting appointmentâ€¦', () =>
        deleteAppointment(action.appointmentId),
      )
      if (removed !== null) {
        await refreshData()
        if (selectedAppointmentId === action.appointmentId) {
          setSelectedAppointmentId('')
          setIsAppointmentFormOpen(false)
          setIsAppointmentEditing(false)
        }
        setStatusText('Appointment deleted.')
      }
      return
    }

    const appointment = appointments.find((item) => item.id === action.appointmentId)
    if (!appointment) {
      return
    }

    const saved = await runTask('Cancelling follow-upâ€¦', () => cancelFollowUp(appointment.id))
    if (saved) {
      await refreshData()
      setStatusText(`Cancelled the follow-up reminder for ${appointment.customerName}.`)
    }
  }

  function editCustomer(customer: CustomerRecord) {
    setCustomerForm({
      id: customer.id,
      name: customer.name,
      address: customer.address,
      email: customer.email,
      phone: customer.phone,
      contactPreference: customer.contactPreference,
      referralSource: customer.referralSource,
      reminderOptIn: customer.reminderOptIn,
      reminderMonths: customer.reminderMonths,
      followUpWeeks: customer.followUpWeeks,
      marketingOptIn: customer.marketingOptIn,
      notes: customer.notes,
    })
    setIsCustomerFormOpen(true)
    setActiveTab('customers')
  }

  function loadAppointmentIntoForm(appointment: AppointmentRecord) {
    setAppointmentForm(appointmentRecordToForm(appointment))
    setAppointmentPricingOptions({
      travelIncluded: appointment.travelCharge > 0,
      pitchRaiseIncluded:
        additionalChargeBreakdown(
          appointment.additionalCharges,
          appointment.additionalChargeNote,
          settings,
        ).pitchRaiseCharge > 0,
      voicingIncluded:
        additionalChargeBreakdown(
          appointment.additionalCharges,
          appointment.additionalChargeNote,
          settings,
        ).voicingCharge > 0,
      repairsAmount: (() => {
        const breakdown = additionalChargeBreakdown(
          appointment.additionalCharges,
          appointment.additionalChargeNote,
          settings,
        )
        return breakdown.repairsCharge || breakdown.genericAdditionalCharges
      })(),
    })
  }

  function openAppointmentDetails(
    appointment: AppointmentRecord,
    origin: DetailOrigin = defaultAppointmentDetailOrigin,
  ) {
    loadAppointmentIntoForm(appointment)
    setAppointmentDetailOrigin(origin)
    setSelectedAppointmentId(appointment.id)
    setIsAppointmentFormOpen(true)
    setIsAppointmentEditing(false)
    setSelectedCustomerId(appointment.customerId)
    setActiveTab('appointments')
  }

  function beginAppointmentEdit(
    appointment: AppointmentRecord,
    origin: DetailOrigin = appointmentDetailOrigin,
  ) {
    loadAppointmentIntoForm(appointment)
    setAppointmentDetailOrigin(origin)
    setSelectedAppointmentId(appointment.id)
    setIsAppointmentFormOpen(true)
    setIsAppointmentEditing(true)
    setSelectedCustomerId(appointment.customerId)
    setActiveTab('appointments')
  }

  function resetCustomerForm() {
    setCustomerForm(emptyCustomerForm(settings))
    setIsCustomerFormOpen(false)
  }

  function startNewCustomer() {
    setCustomerForm(emptyCustomerForm(settings))
    setIsCustomerFormOpen(true)
    setActiveTab('customers')
  }

  function resetAppointmentForm() {
    setAppointmentForm({
      ...emptyAppointmentForm(),
      customerId: selectedCustomer?.id ?? '',
      customerName: selectedCustomer?.name ?? '',
    })
    setAppointmentPricingOptions({
      travelIncluded: false,
      pitchRaiseIncluded: false,
      voicingIncluded: false,
      repairsAmount: 0,
    })
    setIsAppointmentFormOpen(false)
    setIsAppointmentEditing(false)
    setSelectedAppointmentId('')
  }

  function closeAppointmentDetails() {
    resetAppointmentForm()
    setActiveTab(appointmentDetailOrigin.tab)
    setAppointmentDetailOrigin(defaultAppointmentDetailOrigin)
  }

  function startNewAppointment(
    customer?: CustomerRecord | null,
    origin: DetailOrigin = defaultAppointmentDetailOrigin,
  ) {
    setAppointmentForm({
      ...emptyAppointmentForm(),
      customerId: customer?.id ?? '',
      customerName: customer?.name ?? '',
    })
    setAppointmentPricingOptions({
      travelIncluded: false,
      pitchRaiseIncluded: false,
      voicingIncluded: false,
      repairsAmount: 0,
    })
    setAppointmentDetailOrigin(origin)
    setSelectedCustomerId(customer?.id ?? '')
    setSelectedAppointmentId('')
    setIsAppointmentFormOpen(true)
    setIsAppointmentEditing(true)
    setActiveTab('appointments')
  }

  function cancelAppointmentEditing() {
    if (selectedAppointmentId) {
      setIsAppointmentEditing(false)
      return
    }

    closeAppointmentDetails()
  }

  function applyFlatFeePricing() {
    const travelCharge = appointmentPricingOptions.travelIncluded ? settings.defaultTravelCharge : 0
    const pitchRaiseCharge = appointmentPricingOptions.pitchRaiseIncluded
      ? settings.defaultPitchRaiseCharge
      : 0
    const voicingCharge = appointmentPricingOptions.voicingIncluded
      ? settings.defaultVoicingCharge
      : 0
    const repairsCharge = appointmentPricingOptions.repairsAmount
    const additionalCharges = pitchRaiseCharge + voicingCharge + repairsCharge
    const total =
      STANDARD_APPOINTMENT_TOTAL +
      travelCharge +
      additionalCharges
    const breakdown = calculateIncludedTaxBreakdown(
      total,
      settings.defaultTaxRate,
      travelCharge,
      additionalCharges,
    )

    setAppointmentForm((current) => ({
      ...current,
      quotedEstimate: breakdown.quotedEstimate,
      travelCharge: breakdown.travelCharge,
      additionalCharges: breakdown.additionalCharges,
      additionalChargeNote: buildAdditionalChargeNote(
        appointmentPricingOptions.pitchRaiseIncluded,
        appointmentPricingOptions.voicingIncluded,
        appointmentPricingOptions.repairsAmount,
      ),
      taxAmount: breakdown.taxAmount,
    }))
  }

  function updateAppointmentDatePart(datePart: string) {
    setAppointmentForm((current) => {
      const parts = parseAppointmentDateTime(current.appointmentDate)
      return {
        ...current,
        appointmentDate: buildAppointmentDateTime(datePart, parts.hour24, parts.minute),
      }
    })
  }

  function updateAppointmentHour(hour24: number) {
    setAppointmentForm((current) => {
      const parts = parseAppointmentDateTime(current.appointmentDate)
      const nextMinute = hour24 === 20 ? 0 : parts.minute
      return {
        ...current,
        appointmentDate: buildAppointmentDateTime(parts.datePart, hour24, nextMinute),
      }
    })
  }

  function updateAppointmentMinute(minute: number) {
    setAppointmentForm((current) => {
      const parts = parseAppointmentDateTime(current.appointmentDate)
      return {
        ...current,
        appointmentDate: buildAppointmentDateTime(parts.datePart, parts.hour24, minute),
      }
    })
  }

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text)
      setStatusText(successMessage)
    } catch {
      setErrorText('Clipboard access was blocked by the browser.')
    }
  }

  function invoiceText(appointment: AppointmentRecord) {
    const venmoLink = invoiceVenmoLink(appointment) || 'Add your Venmo handle in Settings to generate a payment link.'
    const chargeLines = appointmentChargeDetails(appointment, settings).map(
      ({ label, value }) => `${label}: ${value}`,
    )

    return [
      `Hi ${appointment.customerName},`,
      '',
      `Thanks for scheduling your piano tuning appointment on ${shortDate(appointment.appointmentDate)}.`,
      ...chargeLines,
      appointment.paymentMethod
        ? `Paid via: ${paymentMethodLabel(appointment.paymentMethod)}`
        : 'Payment options: Cash, Check, Venmo',
      '',
      unmonitoredTextNotice(),
      '',
      `Pay with Venmo: ${venmoLink}`,
      `Leave a Google review: ${GOOGLE_REVIEW_LINK}`,
      '',
      'Thank you for supporting my piano tuning business.',
      '',
      'Regards,',
      settings.emailSignature,
    ]
      .filter(Boolean)
      .join('\n')
  }

  function invoicePaymentLine(appointment: AppointmentRecord) {
    return appointment.paymentMethod
      ? `Payment method: ${paymentMethodLabel(appointment.paymentMethod)}`
      : 'Payment options: Cash, Check, Venmo'
  }

  function invoiceVenmoLink(appointment: AppointmentRecord) {
    return settings.venmoHandle
      ? `https://venmo.com/${settings.venmoHandle}?txn=pay&amount=${totalForAppointment(appointment).toFixed(2)}&note=${encodeURIComponent(`Piano tuning on ${shortDate(appointment.appointmentDate)}`)}`
      : ''
  }

  function appointmentChangeNote() {
    return settings.voicePhone.trim()
      ? `Need to make a change to your appointment? ${settings.voicePhone.trim()}`
      : ''
  }

  function unmonitoredTextNotice() {
    return settings.voicePhone.trim()
      ? `This text number is unmonitored. Please contact us at ${settings.voicePhone.trim()} if you need anything.`
      : 'This text number is unmonitored. Please contact us directly if you need anything.'
  }

  function invoiceEmailText(appointment: AppointmentRecord) {
    return [
      `Hi ${appointment.customerName},`,
      '',
      `Thanks for scheduling your piano tuning appointment on ${shortDate(appointment.appointmentDate)}.`,
      '',
      'Thank you for supporting my piano tuning business.',
      '',
      'Regards,',
      settings.emailSignature,
    ].join('\n')
  }

  function appointmentCommunicationDetails(customer: CustomerRecord, appointment: AppointmentRecord) {
    return [
      { label: 'Date / time', value: fullDate(appointment.appointmentDate) },
      { label: 'Name', value: customer.name },
      { label: 'Address', value: customer.address || 'No address on file' },
      { label: 'Quoted price', value: currency(totalForAppointment(appointment)) },
    ]
  }

  function invoiceComposerDetails(customer: CustomerRecord, appointment: AppointmentRecord) {
    return [
      { label: 'Date / time', value: fullDate(appointment.appointmentDate) },
      { label: 'Name', value: customer.name },
      { label: 'Address', value: customer.address || 'No address on file' },
      ...appointmentChargeDetails(appointment, settings),
    ]
  }

  function splitMessageForDetailBlock(text: string) {
    const paragraphs = text
      .split('\n\n')
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)

    return {
      introText: paragraphs.slice(0, 2).join('\n\n'),
      outroText: paragraphs.slice(2).join('\n\n'),
    }
  }

  function detailTableHtml(details: Array<{ label: string; value: string }>) {
    const rows = details
      .map(
        ({ label, value }) => `
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid rgba(33, 76, 60, 0.08); color: #1f1a16; font-size: 16px; font-weight: 700;">
              ${escapeHtml(label)}
            </td>
            <td style="padding: 10px 0; border-bottom: 1px solid rgba(33, 76, 60, 0.08); color: #1f1a16; font-size: 16px; text-align: right;">
              ${escapeHtml(value)}
            </td>
          </tr>
        `,
      )
      .join('')

    return `
      <div style="padding: 12px 0 0; margin: 0 0 16px;">
        <table role="presentation" style="width: 420px; max-width: 100%; border-collapse: collapse; table-layout: fixed;">
          <colgroup>
            <col style="width: 54%;" />
            <col style="width: 46%;" />
          </colgroup>
          ${rows}
        </table>
      </div>
    `
  }

  function appointmentConfirmationText(customer: CustomerRecord) {
    return [
      `Hi ${customer.name},`,
      '',
      'Your piano tuning appointment is confirmed. Here are the details I have on the calendar.',
      appointmentChangeNote(),
      '',
      'Thank you for supporting my piano tuning business.',
      '',
      'Regards,',
      settings.emailSignature,
    ].join('\n')
  }

  function appointmentReminderText(customer: CustomerRecord) {
    return [
      `Hi ${customer.name},`,
      '',
      'This is a reminder for your upcoming piano tuning appointment. Here are the details I have on the calendar.',
      appointmentChangeNote(),
      '',
      'Thank you for supporting my piano tuning business.',
      '',
      'Regards,',
      settings.emailSignature,
    ].join('\n')
  }

  function appointmentConfirmationSms(customer: CustomerRecord, appointment: AppointmentRecord) {
    return [
      `Hi ${customer.name},`,
      '',
      'Your piano tuning appointment is confirmed:',
      `Date/Time: ${fullDate(appointment.appointmentDate)}`,
      `Name: ${customer.name}`,
      `Address: ${customer.address || 'No address on file'}`,
      `Quoted price: ${currency(totalForAppointment(appointment))}`,
      appointmentChangeNote(),
      unmonitoredTextNotice(),
      '',
      settings.smsSignature,
    ].join('\n')
  }

  function appointmentReminderSms(customer: CustomerRecord, appointment: AppointmentRecord) {
    return [
      `Hi ${customer.name},`,
      '',
      'This is a reminder for your upcoming piano tuning appointment:',
      `Date/Time: ${fullDate(appointment.appointmentDate)}`,
      `Name: ${customer.name}`,
      `Address: ${customer.address || 'No address on file'}`,
      `Quoted price: ${currency(totalForAppointment(appointment))}`,
      appointmentChangeNote(),
      unmonitoredTextNotice(),
      '',
      settings.smsSignature,
    ].join('\n')
  }

  function escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }

  function emailShell({
    eyebrow,
    title,
    body,
    ctaLabel,
    ctaHref,
    eyebrowHref,
    plain,
  }: {
    eyebrow: string
    title: string
    body: string
    ctaLabel?: string
    ctaHref?: string
    eyebrowHref?: string
    plain?: boolean
  }) {
    const cta = ctaLabel && ctaHref
      ? `
        <div style="margin: 28px 0 10px;">
          <a href="${ctaHref}" style="display: inline-block; padding: 14px 22px; border-radius: 999px; background: linear-gradient(135deg, #214c3c, #7d5e35); color: #f8f4ec; text-decoration: none; font-weight: 700;">
            ${escapeHtml(ctaLabel)}
          </a>
        </div>
        <p style="margin: 12px 0 0; font-size: 13px; line-height: 1.6; color: #6a5c4d; word-break: break-all;">
          ${escapeHtml(ctaHref)}
        </p>
      `
      : ''

    const outerBackground = plain ? '#ffffff' : '#f4efe6'
    const cardBackground = plain ? '#ffffff' : 'rgba(255, 250, 244, 0.96)'
    const cardBorder = plain ? '0' : '1px solid rgba(28, 42, 36, 0.14)'
    const cardRadius = plain ? '0' : '28px'
    const cardShadow = plain ? 'none' : '0 18px 60px rgba(66, 40, 8, 0.08)'
    const headerBackground = plain
      ? 'transparent'
      : 'linear-gradient(180deg, rgba(33, 76, 60, 0.06), rgba(255, 250, 244, 0))'

    const eyebrowContent = eyebrowHref
      ? `<a href="${escapeHtml(eyebrowHref)}" style="color: #214c3c; text-decoration: none;">${escapeHtml(eyebrow)}</a>`
      : escapeHtml(eyebrow)

    return `
      <div style="margin: 0; padding: 22px 10px; background: ${outerBackground}; font-family: Georgia, 'Times New Roman', serif; color: #1f1a16;">
        <div style="max-width: 520px; margin: 0; background: ${cardBackground}; border: ${cardBorder}; border-radius: ${cardRadius}; box-shadow: ${cardShadow}; overflow: hidden;">
          <div style="padding: 18px 0 12px; background: ${headerBackground};">
            <div style="font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #6a5c4d; margin-bottom: 10px;">
              ${eyebrowContent}
            </div>
            <h1 style="margin: 0; font-size: 34px; line-height: 1.05; color: #214c3c;">
              ${escapeHtml(title)}
            </h1>
          </div>
          <div style="padding: 0 0 20px;">
            ${body}
            ${cta}
          </div>
        </div>
      </div>
    `
  }

  function proseEmailHtml(
    text: string,
    options: {
      eyebrow: string
      title: string
      ctaLabel?: string
      ctaHref?: string
      plain?: boolean
    },
  ) {
    const paragraphs = text
      .split('\n\n')
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map(
        (paragraph) =>
          `<p style="margin: 0 0 16px; font-size: 16px; line-height: 1.7; color: #2f2923;">${escapeHtml(paragraph).replaceAll('\n', '<br />')}</p>`,
      )
      .join('')

    return emailShell({
      eyebrow: options.eyebrow,
      title: options.title,
      body: paragraphs,
      ctaLabel: options.ctaLabel,
      ctaHref: options.ctaHref,
      eyebrowHref: normalizeUrl(settings.websiteUrl),
      plain: options.plain,
    })
  }

  function proseEmailBody(text: string) {
    return text
      .split('\n\n')
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map(
        (paragraph) =>
          `<p style="margin: 0 0 16px; font-size: 16px; line-height: 1.7; color: #2f2923;">${escapeHtml(paragraph).replaceAll('\n', '<br />')}</p>`,
      )
      .join('')
  }

  function invoiceHtml(appointment: AppointmentRecord, messageText = invoiceEmailText(appointment)) {
    const venmoLink = invoiceVenmoLink(appointment)
    const customer = customerMap.get(appointment.customerId)
    const { introText, outroText } = splitMessageForDetailBlock(messageText)
    const intro = introText ? proseEmailBody(introText) : ''
    const outro = outroText ? proseEmailBody(outroText) : ''
    const body = `
      ${intro}
      ${detailTableHtml(
        customer
          ? invoiceComposerDetails(customer, appointment)
          : appointmentChargeDetails(appointment, settings),
      )}
      <p style="margin: 0 0 10px; font-size: 16px; line-height: 1.7; color: #2f2923;">
        <strong>${appointment.paymentMethod ? 'Payment method:' : 'Payment options:'}</strong> ${escapeHtml(
          invoicePaymentLine(appointment).replace(/^Payment (method|options): /, ''),
        )}
      </p>
      ${
        venmoLink
          ? `<p style="margin: 0 0 20px; font-size: 16px; line-height: 1.7; color: #2f2923;">
              <a href="${venmoLink}" style="color: #2f6b85; text-decoration: underline;">Venmo Link</a>
            </p>`
          : ''
      }
      <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.7; color: #2f2923;">
        <a href="${GOOGLE_REVIEW_LINK}" style="color: #2f6b85; text-decoration: underline;">Leave a Google review</a>
      </p>
      ${outro}
    `

    return emailShell({
      eyebrow: settings.businessName,
      title: 'Invoice',
      body,
      eyebrowHref: normalizeUrl(settings.websiteUrl),
      plain: true,
    })
  }

  function appointmentStructuredHtml(
    customer: CustomerRecord,
    appointment: AppointmentRecord,
    messageText: string,
    title: string,
  ) {
    const { introText, outroText } = splitMessageForDetailBlock(messageText)
    const body = `
      ${introText ? proseEmailBody(introText) : ''}
      ${detailTableHtml(appointmentCommunicationDetails(customer, appointment))}
      ${outroText ? proseEmailBody(outroText) : ''}
    `

    return emailShell({
      eyebrow: settings.businessName,
      title,
      body,
      eyebrowHref: normalizeUrl(settings.websiteUrl),
      plain: true,
    })
  }

  function reminderEmailText(customer: CustomerRecord, appointment: AppointmentRecord) {
    return [
      `Hi ${customer.name},`,
      '',
      `It has been ${differenceInCalendarDays(new Date(), parseISO(appointment.appointmentDate))} days since your last piano tuning on ${shortDate(appointment.appointmentDate)}.`,
      'Would you like to get your next tuning on the calendar?',
      '',
      settings.emailSignature,
    ].join('\n')
  }

  function reminderSmsText(customer: CustomerRecord, appointment: AppointmentRecord) {
    return [
      `Hi ${customer.name},`,
      '',
      `It has been ${differenceInCalendarDays(new Date(), parseISO(appointment.appointmentDate))} days since your last piano tuning on ${shortDate(appointment.appointmentDate)}.`,
      'Would you like to get your next tuning on the calendar?',
      '',
      unmonitoredTextNotice(),
      '',
      settings.smsSignature,
    ].join('\n')
  }

  function followUpText(customer: CustomerRecord, appointment: AppointmentRecord) {
    return [
      `Hi ${customer.name},`,
      '',
      `Just checking in after your piano tuning on ${shortDate(appointment.appointmentDate)}.`,
      'Is the piano still working well? Any concerns I can help with?',
      '',
      settings.smsSignature,
    ].join('\n')
  }

  function marketingText() {
    return [
      `Hello from ${settings.businessName},`,
      '',
      'I am currently running a piano tuning special and would love to get your instrument back on the calendar.',
      'Reply if you would like to schedule a visit.',
      '',
      settings.emailSignature,
    ].join('\n')
  }

  function reminderHtml(
    customer: CustomerRecord,
    appointment: AppointmentRecord,
    messageText = reminderEmailText(customer, appointment),
  ) {
    return proseEmailHtml(messageText, {
      eyebrow: settings.businessName,
      title: 'Time for your next tuning',
      plain: true,
    })
  }

  function followUpHtml(customer: CustomerRecord, appointment: AppointmentRecord, messageText = followUpText(customer, appointment)) {
    return proseEmailHtml(messageText, {
      eyebrow: settings.businessName,
      title: 'Checking in after your tuning',
      plain: true,
    })
  }

  function appointmentConfirmationHtml(
    customer: CustomerRecord,
    appointment: AppointmentRecord,
    messageText = appointmentConfirmationText(customer),
  ) {
    return appointmentStructuredHtml(
      customer,
      appointment,
      messageText,
      'Appointment confirmation',
    )
  }

  function appointmentReminderHtml(
    customer: CustomerRecord,
    appointment: AppointmentRecord,
    messageText = appointmentReminderText(customer),
  ) {
    return appointmentStructuredHtml(customer, appointment, messageText, 'Appointment reminder')
  }

  function marketingHtml(messageText = marketingText()) {
    return proseEmailHtml(messageText, {
      eyebrow: settings.businessName,
      title: 'Current piano tuning special',
      plain: true,
    })
  }

  if (!isParseConfigured()) {
    return (
      <main className="setup-shell">
        <section className="setup-card">
          <p className="eyebrow">Pitch Ledger</p>
          <h1>Connect Back4App first</h1>
          <p>
            This app follows the same Parse-style setup as your `hsc_samples` project. Add
            these variables to a local `.env` file, then restart the dev server.
          </p>
          <ul className="setup-list">
            {getMissingParseEnv().map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <pre>{`VITE_PARSE_APP_ID=...
VITE_PARSE_JAVASCRIPT_KEY=...
VITE_PARSE_SERVER_URL=https://parseapi.back4app.com/`}</pre>
        </section>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-header">
            <div className="auth-mark" aria-hidden="true">
              <span className="auth-mark-main"></span>
              <span className="auth-mark-side auth-mark-side-top"></span>
              <span className="auth-mark-side auth-mark-side-bottom"></span>
              <span className="auth-mark-dot auth-mark-dot-a"></span>
              <span className="auth-mark-dot auth-mark-dot-b"></span>
              <span className="auth-mark-dot auth-mark-dot-c"></span>
            </div>
            <h1>Prime Pianos</h1>
          </div>

          <form className="auth-form" onSubmit={handleLogin}>
            <label>
              Username
              <input
                required
                autoComplete="username"
                value={loginForm.username}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, username: event.target.value }))
                }
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, password: event.target.value }))
                }
              />
            </label>
            <button type="submit" className="primary-button" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="message-stack">
            <p>{statusText}</p>
            {errorText ? <p className="error-text">{errorText}</p> : null}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className={isCustomerDirectoryView ? 'app-shell customer-list-page' : 'app-shell'}>
      <section className="app-banner">
        <div className="app-banner-title-row">
          <div className="app-banner-copy">
            <h1>Prime Pianos</h1>
          </div>
          <span className="app-version">v{appVersion}</span>
        </div>
        <div className="app-banner-status-row">
          <span className="app-sync-status">{loading ? 'Working' : 'Synced'}</span>
          <button className="ghost-button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </section>

      <nav className="tab-bar" aria-label="Primary">
        {navigation.map(([key, label]) => (
          <button
            key={key}
            className={activeTab === key ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {errorText ? <p className="error-text">{errorText}</p> : null}

      {activeTab === 'customers' ? (
        <section className="workspace-grid single customer-focus">
          {isCustomerFormOpen ? (
            <article className="panel customer-form-screen">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">CRM</p>
                  <h2>{customerForm.id ? 'Edit customer' : 'New customer'}</h2>
                </div>
                <div className="button-row">
                  <button
                    type="submit"
                    form="customer-form"
                    className="primary-button"
                    disabled={loading}
                  >
                    {customerForm.id ? 'Save customer' : 'Create customer'}
                  </button>
                  <button type="button" className="ghost-button" onClick={resetCustomerForm}>
                    Cancel
                  </button>
                </div>
              </div>

              <form id="customer-form" className="form-grid" onSubmit={handleCustomerSave}>
                <label>
                  Name
                  <input
                    required
                    value={customerForm.name}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={customerForm.phone}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, phone: event.target.value }))
                    }
                  />
                </label>
                <label className="full-width">
                  Address
                  <textarea
                    rows={3}
                    value={customerForm.address}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, address: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={customerForm.email}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Contact preference
                  <select
                    value={customerForm.contactPreference}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        contactPreference: event.target.value as CustomerRecord['contactPreference'],
                      }))
                    }
                  >
                    <option value="">No preference</option>
                    <option value="email">Email</option>
                    <option value="sms">Text</option>
                  </select>
                </label>
                <label>
                  Heard about us
                  <select
                    value={customerForm.referralSource}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        referralSource: event.target.value as CustomerRecord['referralSource'],
                      }))
                    }
                  >
                    <option value="">Not recorded</option>
                    <option value="google_search">Google search</option>
                    <option value="business_card_at_store">Business card at store</option>
                    <option value="friend_family">Friend/family</option>
                    <option value="social_media">Social media</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  Reminder months
                  <input
                    type="number"
                    min="1"
                    value={customerForm.reminderMonths}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        reminderMonths: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Follow-up weeks
                  <input
                    type="number"
                    min="1"
                    value={customerForm.followUpWeeks}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        followUpWeeks: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={customerForm.reminderOptIn}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        reminderOptIn: event.target.checked,
                      }))
                    }
                  />
                  Appointment reminders enabled
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={customerForm.marketingOptIn}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        marketingOptIn: event.target.checked,
                      }))
                    }
                  />
                  Include in marketing blasts
                </label>
                <label className="full-width">
                  Notes
                  <textarea
                    rows={4}
                    value={customerForm.notes}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </label>
              </form>
            </article>
          ) : selectedVisibleCustomer ? (
            <article className="panel customer-detail-screen">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Customer</p>
                  <h2>{selectedVisibleCustomer.name}</h2>
                </div>
                <div className="button-row">
                  <button
                    className="ghost-button"
                    onClick={closeCustomerDetails}
                  >
                    {`Back to ${customerDetailOrigin.label}`}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => editCustomer(selectedVisibleCustomer)}
                  >
                    Edit
                  </button>
                  <button
                    className="ghost-button danger icon-button danger-icon-button"
                    onClick={() => queueDeleteCustomerConfirmation(selectedVisibleCustomer.id)}
                    aria-label={`Delete ${selectedVisibleCustomer.name}`}
                    title={`Delete ${selectedVisibleCustomer.name}`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              <div className="detail-card customer-detail-card">
                <div className="appointment-summary-grid customer-summary-grid">
                  <div className="summary-item">
                    <span>Email</span>
                    <strong>
                      {selectedVisibleCustomer.email ? (
                        <a href={`mailto:${selectedVisibleCustomer.email}`} className="detail-link">
                          {selectedVisibleCustomer.email}
                        </a>
                      ) : (
                        'No email on file'
                      )}
                    </strong>
                  </div>
                  <div className="summary-item">
                    <span>Phone</span>
                    <strong>
                      {selectedVisibleCustomer.phone ? (
                        <a href={`tel:${selectedVisibleCustomer.phone}`} className="detail-link">
                          {selectedVisibleCustomer.phone}
                        </a>
                      ) : (
                        'No phone on file'
                      )}
                    </strong>
                  </div>
                  <div className="summary-item">
                    <span>Reminder cadence</span>
                    <strong>Every {selectedVisibleCustomer.reminderMonths} months</strong>
                  </div>
                  <div className="summary-item">
                    <span>Follow-up cadence</span>
                    <strong>{selectedVisibleCustomer.followUpWeeks} weeks after service</strong>
                  </div>
                  <div className="summary-item">
                    <span>Contact preference</span>
                    <strong>{contactPreferenceLabel(selectedVisibleCustomer.contactPreference)}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Heard about us</span>
                    <strong>{referralSourceLabel(selectedVisibleCustomer.referralSource)}</strong>
                  </div>
                  <div className="summary-item full-span">
                    <span>Address</span>
                    <strong>
                      {selectedVisibleCustomer.address ? (
                        <a
                          href={mapLink(selectedVisibleCustomer.address)}
                          className="detail-link"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {selectedVisibleCustomer.address}
                        </a>
                      ) : (
                        'No address on file yet.'
                      )}
                    </strong>
                  </div>
                </div>
                <div className="summary-notes">
                  <span>Notes</span>
                  <p className="detail-notes">{selectedVisibleCustomer.notes || 'No notes yet.'}</p>
                </div>

                <div className="customer-history">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">History</p>
                      <h3>Recent appointments</h3>
                    </div>
                    <button
                      className="ghost-button"
                      onClick={() =>
                        startNewAppointment(selectedVisibleCustomer, detailOrigin('customers', 'customer'))
                      }
                    >
                      Book appointment
                    </button>
                  </div>
                  <div className="customer-history-list">
                    {customerAppointments(selectedVisibleCustomer.id)
                      .slice(0, 5)
                      .map((appointment) => (
                        <button
                          key={appointment.id}
                          className="history-row"
                          onClick={() =>
                            openAppointmentDetails(appointment, detailOrigin('customers', 'customer'))
                          }
                        >
                          <strong>{shortDate(appointment.appointmentDate)}</strong>
                          <span>{appointment.status}</span>
                          <span>{currency(totalForAppointment(appointment))}</span>
                        </button>
                      ))}
                    {customerAppointments(selectedVisibleCustomer.id).length === 0 ? (
                      <p className="empty-state">No appointments recorded yet.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          ) : (
            <article className="panel customer-directory-panel">
              <div className="panel-heading compact customer-directory-heading">
                <h2 className="section-title-compact">Customers</h2>
              </div>

              <div className="customer-directory-controls">
                <input
                  placeholder="Search name, phone, email, address"
                  value={filters.customerSearch}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, customerSearch: event.target.value }))
                  }
                />
                <div className="customer-toolbar">
                  <span className="customer-search-meta">
                    {filteredCustomers.length} of {customers.length}
                  </span>
                  <button className="secondary-button" onClick={startNewCustomer}>
                    Add customer
                  </button>
                  {filters.customerSearch ? (
                    <button
                      className="ghost-button"
                      onClick={() =>
                        setFilters((current) => ({
                          ...current,
                          customerSearch: '',
                        }))
                      }
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="customer-list">
                {filteredCustomers.map((customer) => {
                  const lastService = lastServiceForCustomer(customer.id)
                  return (
                    <div key={customer.id} className="customer-row">
                      <button
                        className="customer-card customer-card-button"
                        onClick={() => setSelectedCustomerId(customer.id)}
                      >
                        <div className="customer-card-primary">
                          <strong>{customer.name}</strong>
                        </div>
                        <div className="customer-card-secondary">
                          <span>
                            {lastService
                              ? `Last tuned ${shortDate(lastService.appointmentDate)}`
                              : 'No service history yet'}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="ghost-button danger icon-button danger-icon-button customer-row-delete"
                        onClick={() => queueDeleteCustomerConfirmation(customer.id)}
                        aria-label={`Delete ${customer.name}`}
                        title={`Delete ${customer.name}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  )
                })}
                {filteredCustomers.length === 0 ? (
                  <p className="empty-state">No customers match that search yet.</p>
                ) : null}
              </div>
            </article>
          )}
        </section>
      ) : null}

      {activeTab === 'reports' ? (
        <>
          <section className="stats-grid">
            <StatCard
              label="Outstanding invoices"
              value={String(outstandingInvoices.length)}
              detail={`${currency(outstandingInvoices.reduce((sum, appointment) => sum + totalForAppointment(appointment), 0))} not marked paid`}
            />
            <StatCard
              label={reportRange.label}
              value={currency(periodSales)}
              detail={`${currency(periodTaxCollected)} tax collected • ${periodAppointments.length} completed or billed appointments`}
              action={
                <select
                  className="stat-card-select"
                  aria-label="Sales report period"
                  value={reportPeriod}
                  onChange={(event) => setReportPeriod(event.target.value as ReportPeriod)}
                >
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="quarter">Quarter</option>
                  <option value="year">Year</option>
                  <option value="all">All time</option>
                </select>
              }
            />
          </section>

          <section className="reports-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Taxes</p>
                  <h2>Quarterly filing snapshot</h2>
                </div>
                <select
                  className="stat-card-select"
                  aria-label="Tax filing quarter"
                  value={activeQuarterLabel}
                  onChange={(event) => setSelectedQuarterLabel(event.target.value)}
                >
                  {quarterSummary.map((quarter) => (
                    <option key={quarter.label} value={quarter.label}>
                      {quarter.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="quarter-list">
                {selectedQuarter ? (
                  <div className="quarter-row">
                    <strong>{selectedQuarter.label}</strong>
                    <span>{currency(selectedQuarter.sales)} sales</span>
                    <span>{currency(selectedQuarter.tax)} tax</span>
                    <span>{selectedQuarter.count} appointments</span>
                  </div>
                ) : (
                  <p className="empty-state">No quarterly tax history is recorded yet.</p>
                )}
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Sales</p>
                  <h2>Recent completed appointments</h2>
                </div>
              </div>
              <div className="queue-list">
                {completedAppointments.slice(0, 8).map((appointment) => (
                  <button
                    key={appointment.id}
                    className="queue-card recent-sales-row"
                    onClick={() =>
                      openAppointmentDetails(appointment, detailOrigin('reports', 'sales reports'))
                    }
                  >
                    <strong className="recent-sales-customer">{appointment.customerName}</strong>
                    <span className="recent-sales-date">{fullDate(appointment.appointmentDate)}</span>
                    <span className="recent-sales-summary">
                      {currency(
                        appointment.quotedEstimate +
                          appointment.travelCharge +
                          appointment.additionalCharges,
                      )}{' '}
                      sales • {currency(appointment.taxAmount)} tax
                    </span>
                  </button>
                ))}
                {completedAppointments.length === 0 ? (
                  <p className="empty-state">No completed appointments are recorded yet.</p>
                ) : null}
              </div>
            </article>

            <article className="panel referral-report-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Customers</p>
                  <h2>How customers heard about us</h2>
                </div>
                <span>
                  {totalRecordedReferralCount} recorded
                  {unrecordedReferralCount ? ` • ${unrecordedReferralCount} not recorded` : ''}
                </span>
              </div>
              {totalRecordedReferralCount > 0 ? (
                <div className="referral-report-layout">
                  <div className="referral-chart-wrap" aria-hidden="true">
                    <svg
                      viewBox="0 0 240 240"
                      className="referral-chart"
                      role="img"
                      aria-label="Pie chart showing how customers heard about Prime Pianos"
                    >
                      {recordedReferralCounts.length === 1 ? (
                        <circle
                          cx="120"
                          cy="120"
                          r="92"
                          fill={recordedReferralCounts[0].color}
                        />
                      ) : (
                        recordedReferralCounts.map((item, index) => {
                          const previousCount = recordedReferralCounts
                            .slice(0, index)
                            .reduce((sum, current) => sum + current.count, 0)
                          const startAngle = (previousCount / totalRecordedReferralCount) * 360
                          const endAngle =
                            ((previousCount + item.count) / totalRecordedReferralCount) * 360

                          return (
                            <path
                              key={item.key}
                              d={pieChartSegmentPath(120, 120, 92, startAngle, endAngle)}
                              fill={item.color}
                              stroke="#f8f4ec"
                              strokeWidth="3"
                            />
                          )
                        })
                      )}
                    </svg>
                  </div>
                  <div className="referral-legend">
                    {recordedReferralCounts.map((item) => {
                      const share = (item.count / totalRecordedReferralCount) * 100
                      return (
                        <div key={item.key} className="referral-legend-row">
                          <span
                            className="referral-legend-swatch"
                            style={{ backgroundColor: item.color }}
                            aria-hidden="true"
                          ></span>
                          <span className="referral-legend-label">{item.label}</span>
                          <span className="referral-legend-value">
                            {item.count} • {share.toFixed(0)}%
                          </span>
                        </div>
                      )
                    })}
                    {unrecordedReferralCount > 0 ? (
                      <p className="referral-report-note">
                        {unrecordedReferralCount} customer
                        {unrecordedReferralCount === 1 ? '' : 's'} still need a referral source.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="empty-state">
                  No referral-source data has been recorded yet.
                </p>
              )}
            </article>
          </section>
        </>
      ) : null}

      {activeTab === 'appointments' ? (
        <section
          className={
            isAppointmentFormOpen
              ? 'workspace-grid appointments-shell appointment-focus'
              : 'workspace-grid appointments-shell'
          }
        >
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Scheduling</p>
                <h2>Appointments</h2>
              </div>
              <button
                className="secondary-button"
                onClick={() =>
                  startNewAppointment(selectedCustomer, detailOrigin('appointments', 'calendar'))
                }
              >
                New appointment
              </button>
            </div>

            <div className="appointments-dashboard">
              <section className="schedule-block">
                <div className="schedule-header">
                  <p className="eyebrow">Coming up</p>
                  <h3>Next 2 weeks</h3>
                  <span className="schedule-header-meta">
                    {nextTwoWeeksAppointments.length} scheduled
                  </span>
                </div>
                {nextTwoWeeksAppointments.length ? (
                  <div className="appointment-table-wrap">
                    <table className="appointment-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Customer</th>
                          <th>Status</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nextTwoWeeksAppointments.map((appointment) => (
                          <tr
                            key={appointment.id}
                            className="interactive-row"
                            onClick={() =>
                              openAppointmentDetails(
                                appointment,
                                detailOrigin('appointments', 'calendar'),
                              )
                            }
                          >
                            <td>{shortDateTime(appointment.appointmentDate)}</td>
                            <td>{appointment.customerName}</td>
                            <td>{appointment.status}</td>
                            <td>{currency(totalForAppointment(appointment))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-state">No appointments are scheduled in the next 14 days.</p>
                )}
              </section>

              <section className="schedule-block">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">Calendar</p>
                    <h3>{format(calendarMonth, 'MMMM yyyy')}</h3>
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setCalendarMonth((current) => subMonths(current, 1))}
                    >
                      {'<<'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setCalendarMonth(startOfMonth(new Date()))}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setCalendarMonth((current) => addMonths(current, 1))}
                    >
                      {'>>'}
                    </button>
                  </div>
                </div>
                <div className="calendar-weekdays" aria-hidden="true">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                <div className="calendar-grid">
                  {calendarDays.map((day) => {
                    const key = format(day, 'yyyy-MM-dd')
                    const dayAppointments = appointmentsByDay[key] ?? []
                    return (
                      <div
                        key={key}
                        className={
                          isSameMonth(day, calendarMonth)
                            ? isSameDay(day, today)
                              ? 'calendar-day today'
                              : 'calendar-day'
                            : 'calendar-day muted'
                        }
                      >
                        <div className="calendar-day-label">{format(day, 'd')}</div>
                        <div className="calendar-day-events">
                          {dayAppointments.slice(0, 3).map((appointment) => (
                            <button
                              key={appointment.id}
                              type="button"
                              className={calendarEventClass(appointment.status)}
                              onClick={() =>
                                openAppointmentDetails(
                                  appointment,
                                  detailOrigin('appointments', 'calendar'),
                                )
                              }
                              title={`${format(parseISO(appointment.appointmentDate), 'h:mm a')} ${appointment.customerName}`}
                            >
                              <span className="calendar-event-time">
                                {format(parseISO(appointment.appointmentDate), 'h:mm a')}
                              </span>
                              <strong className="calendar-event-name">
                                {appointment.customerName}
                              </strong>
                            </button>
                          ))}
                          {dayAppointments.length > 3 ? (
                            <span className="calendar-overflow">
                              +{dayAppointments.length - 3} more
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>

            <div className="appointment-list">
              {sortedAppointments.map((appointment) => (
                <div key={appointment.id} className="appointment-card service-history-row">
                  <button
                    type="button"
                    className="appointment-main service-history-main"
                    onClick={() =>
                      openAppointmentDetails(appointment, detailOrigin('appointments', 'calendar'))
                    }
                  >
                    <strong className="service-history-customer">{appointment.customerName}</strong>
                    <span className="service-history-date">{fullDate(appointment.appointmentDate)}</span>
                    <span className="service-history-summary">
                      {appointment.status} • {currency(totalForAppointment(appointment))}
                    </span>
                  </button>
                  <button
                    className="ghost-button danger icon-button danger-icon-button service-history-delete"
                    onClick={() => queueDeleteAppointmentConfirmation(appointment.id)}
                    aria-label={`Delete appointment for ${appointment.customerName}`}
                    title={`Delete appointment for ${appointment.customerName}`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Scheduling</p>
                <h2>
                  {isAppointmentEditing
                    ? appointmentForm.id
                      ? 'Edit appointment'
                      : 'New appointment'
                    : 'Appointment details'}
                </h2>
              </div>
              <div className="button-row">
                {isAppointmentEditing ? (
                  <>
                    <button
                      type="submit"
                      form="appointment-form"
                      className="primary-button"
                      disabled={loading}
                    >
                      {appointmentForm.id ? 'Save appointment' : 'Create appointment'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={cancelAppointmentEditing}
                    >
                      Cancel
                    </button>
                  </>
                ) : selectedAppointment ? (
                  <>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={closeAppointmentDetails}
                    >
                      {`Back to ${appointmentDetailOrigin.label}`}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        selectedAppointment
                          ? beginAppointmentEdit(selectedAppointment, appointmentDetailOrigin)
                          : null
                      }
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost-button danger icon-button danger-icon-button"
                      onClick={() => queueDeleteAppointmentConfirmation(selectedAppointment.id)}
                      aria-label={`Delete appointment for ${selectedAppointment.customerName}`}
                      title={`Delete appointment for ${selectedAppointment.customerName}`}
                    >
                      <TrashIcon />
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {isAppointmentEditing ? (
              <form id="appointment-form" className="form-grid" onSubmit={handleAppointmentSave}>
                <label className="full-width">
                  Customer
                  <select
                    required
                    value={appointmentForm.customerId}
                    onChange={(event) => {
                      const nextCustomer = customerMap.get(event.target.value)
                      setAppointmentForm((current) => ({
                        ...current,
                        customerId: event.target.value,
                        customerName: nextCustomer?.name ?? '',
                      }))
                      setSelectedCustomerId(event.target.value)
                    }}
                  >
                    <option value="">Select customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Appointment date
                  <input
                    required
                    type="date"
                    value={appointmentTimeParts.datePart}
                    onChange={(event) => updateAppointmentDatePart(event.target.value)}
                  />
                </label>
                <label>
                  Appointment hour
                  <select
                    value={appointmentTimeParts.hour24}
                    onChange={(event) => updateAppointmentHour(Number(event.target.value))}
                  >
                    {appointmentHourOptions.map((hour24) => (
                      <option key={hour24} value={hour24}>
                        {formatHourOption(hour24)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Appointment minute
                  <select
                    value={appointmentTimeParts.minute}
                    onChange={(event) => updateAppointmentMinute(Number(event.target.value))}
                  >
                    {appointmentMinuteOptions
                      .filter((minute) => appointmentTimeParts.hour24 !== 20 || minute === 0)
                      .map((minute) => (
                        <option key={minute} value={minute}>
                          {String(minute).padStart(2, '0')}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Status
                  <select
                    value={appointmentForm.status}
                    onChange={(event) =>
                      setAppointmentForm((current) => ({
                        ...current,
                        status: event.target.value as AppointmentStatus,
                      }))
                    }
                  >
                    <option value="scheduled">Scheduled</option>
                    <option value="completed">Completed</option>
                    <option value="invoiced">Invoiced</option>
                    <option value="paid">Paid</option>
                  </select>
                </label>
                <label>
                  Payment method
                  <select
                    value={appointmentForm.paymentMethod}
                    onChange={(event) =>
                      setAppointmentForm((current) => ({
                        ...current,
                        paymentMethod: event.target.value as PaymentMethod,
                      }))
                    }
                  >
                    <option value="">Not recorded</option>
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="venmo">Venmo</option>
                  </select>
                </label>
                <div className="full-width pricing-helper-card">
                  <div className="pricing-helper-header">
                    <strong>Flat-fee calculator</strong>
                    <span>
                      Target total {currency(
                        STANDARD_APPOINTMENT_TOTAL +
                          (appointmentPricingOptions.travelIncluded
                            ? settings.defaultTravelCharge
                            : 0) +
                          (appointmentPricingOptions.pitchRaiseIncluded
                            ? settings.defaultPitchRaiseCharge
                            : 0) +
                          (appointmentPricingOptions.voicingIncluded
                            ? settings.defaultVoicingCharge
                            : 0) +
                          appointmentPricingOptions.repairsAmount,
                      )}{' '}
                      including tax
                    </span>
                  </div>
                  <div className="pricing-helper-controls">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={appointmentPricingOptions.travelIncluded}
                        onChange={(event) =>
                          setAppointmentPricingOptions((current) => ({
                            ...current,
                            travelIncluded: event.target.checked,
                          }))
                        }
                      />
                      Travel
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={appointmentPricingOptions.pitchRaiseIncluded}
                        onChange={(event) =>
                          setAppointmentPricingOptions((current) => ({
                            ...current,
                            pitchRaiseIncluded: event.target.checked,
                          }))
                        }
                      />
                      Pitch raise
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={appointmentPricingOptions.voicingIncluded}
                        onChange={(event) =>
                          setAppointmentPricingOptions((current) => ({
                            ...current,
                            voicingIncluded: event.target.checked,
                          }))
                        }
                      />
                      Voicing
                    </label>
                    <label>
                      Repairs
                      <select
                        value={appointmentPricingOptions.repairsAmount}
                        onChange={(event) =>
                          setAppointmentPricingOptions((current) => ({
                            ...current,
                            repairsAmount: Number(event.target.value),
                          }))
                        }
                      >
                        {repairAmountOptions.map((amount) => (
                          <option key={amount} value={amount}>
                            {amount === 0 ? 'None' : currency(amount)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary-button pricing-helper-button"
                      onClick={applyFlatFeePricing}
                    >
                      Calculate
                    </button>
                  </div>
                </div>
                <label>
                  Quoted estimate
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      appointmentForm.quotedEstimate === 0 ? '' : appointmentForm.quotedEstimate
                    }
                    onChange={(event) =>
                      setAppointmentForm((current) => ({
                        ...current,
                        quotedEstimate: event.target.value === '' ? 0 : Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Travel charge
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={appointmentForm.travelCharge === 0 ? '' : appointmentForm.travelCharge}
                    onChange={(event) =>
                      setAppointmentForm((current) => ({
                        ...current,
                        travelCharge: event.target.value === '' ? 0 : Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Additional services total
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      appointmentForm.additionalCharges === 0 ? ''
                        : appointmentForm.additionalCharges
                    }
                    onChange={(event) =>
                      setAppointmentForm((current) => ({
                        ...current,
                        additionalCharges:
                          event.target.value === '' ? 0 : Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Additional services note
                  <input
                    placeholder="Pitch raise, voicing, repair details, or notes"
                    value={appointmentForm.additionalChargeNote}
                    onChange={(event) =>
                      setAppointmentForm((current) => ({
                        ...current,
                        additionalChargeNote: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Tax amount
                  <div className="inline-field">
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={appointmentForm.taxAmount === 0 ? '' : appointmentForm.taxAmount}
                      onChange={(event) =>
                        setAppointmentForm((current) => ({
                          ...current,
                          taxAmount: event.target.value === '' ? 0 : Number(event.target.value),
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        setAppointmentForm((current) => ({
                          ...current,
                          taxAmount: Number(
                            (
                              (current.quotedEstimate +
                                current.travelCharge +
                                current.additionalCharges) *
                              settings.defaultTaxRate
                            ).toFixed(2),
                          ),
                        }))
                      }
                    >
                      Apply {percent(settings.defaultTaxRate)}
                    </button>
                  </div>
                </label>
                <label className="full-width">
                  Notes
                  <textarea
                    rows={5}
                    value={appointmentForm.notes}
                    onChange={(event) =>
                      setAppointmentForm((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </label>
                <div className="detail-card accent">
                  <span>Total due</span>
                  <strong>{currency(totalForAppointment(appointmentForm))}</strong>
                </div>
                <div className="full-width detail-actions">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={loading}
                  >
                    {appointmentForm.id ? 'Save appointment' : 'Create appointment'}
                  </button>
                </div>
              </form>
            ) : selectedAppointment ? (
              <div className="detail-card appointment-detail-card">
                {(() => {
                  const chargeDetails = appointmentChargeDetails(selectedAppointment, settings)
                  return (
                <div className="appointment-summary-grid">
                  <div className="summary-item">
                    <span>Customer</span>
                    <strong>{selectedAppointment.customerName}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Date</span>
                    <strong>{fullDate(selectedAppointment.appointmentDate)}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Status</span>
                    <strong>{selectedAppointment.status}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Total due</span>
                    <strong>{currency(totalForAppointment(selectedAppointment))}</strong>
                  </div>
                  {chargeDetails
                    .filter(({ label }) => label !== 'Total')
                    .map(({ label, value }) => (
                      <div key={label} className="summary-item">
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  <div className="summary-item">
                    <span>Payment method</span>
                    <strong>{paymentMethodLabel(selectedAppointment.paymentMethod)}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Phone</span>
                    <strong>
                      {customerMap.get(selectedAppointment.customerId)?.phone ? (
                        <a
                          href={`tel:${customerMap.get(selectedAppointment.customerId)?.phone}`}
                          className="detail-link"
                        >
                          {customerMap.get(selectedAppointment.customerId)?.phone}
                        </a>
                      ) : (
                        'No phone on file'
                      )}
                    </strong>
                  </div>
                  <div className="summary-item">
                    <span>Address</span>
                    <strong>
                      {customerMap.get(selectedAppointment.customerId)?.address ? (
                        <a
                          href={mapLink(customerMap.get(selectedAppointment.customerId)!.address)}
                          className="detail-link"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {customerMap.get(selectedAppointment.customerId)?.address}
                        </a>
                      ) : (
                        'No address on file'
                      )}
                    </strong>
                  </div>
                </div>
                  )
                })()}
                <div className="summary-notes">
                  <span>Notes</span>
                  <p className="detail-notes">{selectedAppointment.notes || 'No notes yet.'}</p>
                </div>
              </div>
            ) : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'history' ? (
        <section className="workspace-grid single">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Service Log</p>
                <h2>Service History</h2>
              </div>
              <span>{filteredServiceHistoryAppointments.length} recorded visits</span>
            </div>

            <div className="customer-toolbar">
              <input
                type="search"
                placeholder="Search customer, date, status, notes"
                value={filters.serviceHistorySearch}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    serviceHistorySearch: event.target.value,
                  }))
                }
              />
              {filters.serviceHistorySearch ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      serviceHistorySearch: '',
                    }))
                  }
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div className="appointment-list">
              {filteredServiceHistoryAppointments.map((appointment) => (
                <div key={appointment.id} className="appointment-card service-history-row">
                  <div className="service-history-main">
                    <button
                      type="button"
                      className="inline-link-button workflow-name-link service-history-customer-link"
                      onClick={() =>
                        openCustomerDetails(
                          appointment.customerId,
                          detailOrigin('history', 'service history'),
                        )
                      }
                    >
                      {appointment.customerName}
                    </button>
                    <button
                      type="button"
                      className="appointment-main service-history-detail-trigger"
                      onClick={() =>
                        openAppointmentDetails(appointment, detailOrigin('history', 'service history'))
                      }
                    >
                      <span className="service-history-date">{fullDate(appointment.appointmentDate)}</span>
                      <span className="service-history-summary">
                        {appointment.status} • {currency(totalForAppointment(appointment))}
                      </span>
                    </button>
                  </div>
                  <button
                    className="ghost-button danger icon-button danger-icon-button service-history-delete"
                    onClick={() => queueDeleteAppointmentConfirmation(appointment.id)}
                    aria-label={`Delete appointment for ${appointment.customerName}`}
                    title={`Delete appointment for ${appointment.customerName}`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
              {filteredServiceHistoryAppointments.length === 0 ? (
                <p className="empty-state">
                  {filters.serviceHistorySearch
                    ? 'No service visits match that search.'
                    : 'No completed appointments are recorded yet.'}
                </p>
              ) : null}
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === 'invoices' ? (
        <section className="workflow-grid invoice-view">
          <article className="panel invoice-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Invoicing</p>
                <h2>Not yet invoiced</h2>
              </div>
              <span className="invoice-count">{uninvoicedAppointments.length} shown</span>
            </div>
            {renderInvoiceQueue(
              uninvoicedAppointments,
              'No completed appointments are waiting for an invoice.',
              (appointment) => `Service date ${shortDate(appointment.appointmentDate)}`,
            )}
          </article>

          <article className="panel invoice-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Invoicing</p>
                <h2>Invoiced, not yet paid</h2>
              </div>
              <span className="invoice-count">{unpaidAppointments.length} shown</span>
            </div>
            {renderInvoiceQueue(
              unpaidAppointments,
              'No invoiced appointments are still waiting for payment.',
              (appointment) =>
                appointment.invoiceSentAt
                  ? `Invoice sent ${shortDate(appointment.invoiceSentAt)}`
                  : 'Invoice ready to send',
            )}
          </article>

          <article className="panel invoice-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Invoicing</p>
                <h2>Paid in the last 2 weeks</h2>
              </div>
              <span className="invoice-count">{recentlyPaidAppointments.length} shown</span>
            </div>
            {renderInvoiceQueue(
              recentlyPaidAppointments,
              'No appointments have been marked paid in the last 2 weeks.',
              (appointment) =>
                `Paid ${shortDate(appointment.updatedAt)} • ${paymentMethodLabel(appointment.paymentMethod)}`,
              {
                showCommunicationActions: false,
              },
            )}
          </article>
        </section>
      ) : null}

      {activeTab === 'followups' ? (
        <section className="workflow-grid">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Future appointments</p>
                <h2>Future appointments - send reminders</h2>
              </div>
            </div>
            <div className="queue-list">
              {upcomingAppointmentQueue.map(({ appointment, customer }) => {
                const lastReminder = latestAppointmentReminderByAppointmentId.get(appointment.id)

                return (
                  <div key={appointment.id} className="queue-card follow-up-card">
                    <div>
                      <button
                        type="button"
                        className="inline-link-button workflow-name-link"
                        onClick={() => openCustomerDetails(customer.id, detailOrigin('followups', 'follow-ups'))}
                      >
                        {customer.name}
                      </button>
                      <span>{fullDate(appointment.appointmentDate)}</span>
                      <span>{customer.address || 'No address on file'}</span>
                      <span>
                        {lastReminder
                          ? `Last reminder ${communicationChannelLabel(lastReminder.channel).toLowerCase()} ${shortDate(lastReminder.createdAt)}`
                          : 'No reminder sent yet'}
                      </span>
                    </div>
                    <div className="follow-up-actions">
                      <button
                        className="secondary-button"
                        onClick={() =>
                          openAppointmentDetails(appointment, detailOrigin('followups', 'follow-ups'))
                        }
                      >
                        Appt
                      </button>
                      {customerCanUseChannel(customer, 'email') ? (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            openUpcomingAppointmentReminderComposer('email', customer, appointment)
                          }
                        >
                          Email
                        </button>
                      ) : null}
                      {customerCanUseChannel(customer, 'sms') ? (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            openUpcomingAppointmentReminderComposer('sms', customer, appointment)
                          }
                        >
                          Text
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
              {upcomingAppointmentQueue.length === 0 ? (
                <p className="empty-state">No upcoming scheduled appointments in the next week.</p>
              ) : null}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Reminders</p>
                <h2>Customers due for the next tuning</h2>
              </div>
            </div>
            <div className="queue-list">
              {reminderQueue.map(({ customer, lastService, dueDate }) => (
                <div key={customer.id} className="queue-card">
                  <div>
                    <button
                      type="button"
                      className="inline-link-button workflow-name-link"
                      onClick={() => openCustomerDetails(customer.id, detailOrigin('followups', 'follow-ups'))}
                    >
                      {customer.name}
                    </button>
                    <span>Last service {shortDate(lastService.appointmentDate)}</span>
                    <span>Reminder due {shortDate(dueDate.toISOString())}</span>
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        openAppointmentDetails(lastService, detailOrigin('followups', 'follow-ups'))
                      }
                    >
                      Appt
                    </button>
                    {customerCanUseChannel(customer, 'email') ? (
                      <button
                        className="secondary-button"
                        onClick={() => openRecurringReminderComposer('email', customer, lastService)}
                      >
                        Email
                      </button>
                    ) : null}
                    {customerCanUseChannel(customer, 'sms') ? (
                      <button
                        className="secondary-button"
                        onClick={() => openRecurringReminderComposer('sms', customer, lastService)}
                      >
                        Text
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Follow-up</p>
                <h2>Post-appointment check-ins</h2>
              </div>
            </div>
            <div className="queue-list">
              {followUpQueue.map(({ appointment, customer }) => (
                <div key={appointment.id} className="queue-card follow-up-card">
                  <div>
                    <button
                      type="button"
                      className="inline-link-button workflow-name-link"
                      onClick={() => openCustomerDetails(customer.id, detailOrigin('followups', 'follow-ups'))}
                    >
                      {customer.name}
                    </button>
                    <span>
                      <strong>Service date</strong> {shortDate(appointment.appointmentDate)}
                    </span>
                    <span>
                      <strong>Follow-up window</strong> {customer.followUpWeeks} weeks
                    </span>
                  </div>
                  <div className="button-row follow-up-actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        openAppointmentDetails(appointment, detailOrigin('followups', 'follow-ups'))
                      }
                    >
                      Appointment
                    </button>
                    {customerCanUseChannel(customer, 'email') ? (
                      <button
                        className="secondary-button"
                        onClick={() => openFollowUpComposer('email', customer, appointment)}
                      >
                        Email
                      </button>
                    ) : null}
                    {customerCanUseChannel(customer, 'sms') ? (
                      <button
                        className="secondary-button"
                        onClick={() => openFollowUpComposer('sms', customer, appointment)}
                      >
                        Text
                      </button>
                    ) : null}
                    <button
                      className="ghost-button danger icon-button follow-up-delete-button"
                      onClick={() => queueCancelFollowUpConfirmation(appointment)}
                      aria-label="Cancel follow-up reminder"
                      title="Cancel follow-up reminder"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 12a2 2 0 0 1-2-2V8h12v11a2 2 0 0 1-2 2H8z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
              {followUpQueue.length === 0 ? (
                <p className="empty-state">No follow-up reminders are waiting right now.</p>
              ) : null}
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === 'communications' ? (
        <section className="workspace-grid single">
          <article className="panel communication-log-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Communication Log</p>
                <h2>Recent sent customer messages</h2>
              </div>
              <span>{filteredCommunicationLogs.length} shown</span>
            </div>
            <div className="customer-directory-controls">
              <input
                placeholder="Search customer, recipient, subject, message, channel"
                value={filters.communicationSearch}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    communicationSearch: event.target.value,
                  }))
                }
              />
            </div>
            <div className="queue-list communication-log-list">
              {filteredCommunicationLogs.slice(0, 40).map((item) => {
                const customer = item.customerId ? customerMap.get(item.customerId) : null
                const appointment = item.appointmentId
                  ? appointments.find((candidate) => candidate.id === item.appointmentId) ?? null
                  : null

                return (
                  <div key={item.id} className="queue-card communication-log-row">
                    <div>
                      {customer ? (
                        <button
                          type="button"
                          className="inline-link-button workflow-name-link"
                          onClick={() =>
                            openCustomerDetails(customer.id, detailOrigin('communications', 'communication log'))
                          }
                        >
                          {customer.name}
                        </button>
                      ) : (
                        <strong>{appointment?.customerName || item.recipient}</strong>
                      )}
                      <span>
                        {communicationChannelLabel(item.channel)} • {communicationKindLabel(item.kind)} •{' '}
                        {fullDate(item.createdAt)}
                      </span>
                      <span>
                        To: {item.recipient}
                        {item.subject ? ` • ${item.subject}` : ''}
                      </span>
                      <span>{communicationPreview(item.body).slice(0, 220)}</span>
                    </div>
                    {appointment ? (
                      <div className="button-row">
                        <button
                          className="secondary-button"
                          onClick={() =>
                            openAppointmentDetails(
                              appointment,
                              detailOrigin('communications', 'communication log'),
                            )
                          }
                        >
                          Appt
                        </button>
                        {appointment.status !== 'paid' ? (
                          <button
                            className="secondary-button"
                            onClick={() => openMarkPaidModal(appointment)}
                          >
                            Mark paid
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {filteredCommunicationLogs.length === 0 ? (
                <p className="empty-state">
                  {filters.communicationSearch
                    ? 'No sent communications match that search.'
                    : 'No customer communications have been sent yet.'}
                </p>
              ) : null}
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === 'workflows' ? (
        <section className="workflow-grid">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Invoices</p>
                <h2>Email or text with Venmo link</h2>
              </div>
            </div>
            <div className="queue-list">
              {invoiceQueueAppointments.slice(0, 8).map((appointment) => (
                <div key={appointment.id} className="queue-card invoice-queue-card">
                  <div>
                    <button
                      type="button"
                      className="inline-link-button workflow-name-link"
                      onClick={() => openCustomerDetailsFromWorkflow(appointment.customerId)}
                    >
                      {appointment.customerName}
                    </button>
                    <span>{currency(totalForAppointment(appointment))}</span>
                    <span>
                      {appointment.invoiceSentAt
                        ? `Last sent ${shortDate(appointment.invoiceSentAt)}`
                        : 'Not sent yet'}
                    </span>
                  </div>
                  <div className="workflow-action-stack">
                    <div className="workflow-action-row workflow-action-row-primary">
                      {customerMap.get(appointment.customerId) &&
                      customerCanUseChannel(customerMap.get(appointment.customerId)!, 'email') ? (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            openInvoiceComposer(
                              'email',
                              customerMap.get(appointment.customerId)!,
                              appointment,
                            )
                          }
                        >
                          Email
                        </button>
                      ) : null}
                      {customerMap.get(appointment.customerId) &&
                      customerCanUseChannel(customerMap.get(appointment.customerId)!, 'sms') ? (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            openInvoiceComposer(
                              'sms',
                              customerMap.get(appointment.customerId)!,
                              appointment,
                            )
                          }
                        >
                          Text
                        </button>
                      ) : null}
                      <button
                        className="secondary-button"
                        onClick={() =>
                          copyText(invoiceText(appointment), 'Invoice text copied to clipboard.')
                        }
                      >
                        Copy
                      </button>
                    </div>
                    <div className="workflow-action-row workflow-action-row-secondary">
                      <button
                        className="secondary-button"
                        onClick={() => openAppointmentDetails(appointment)}
                      >
                        Appt
                      </button>
                      {appointment.status !== 'paid' ? (
                        <button
                          className="secondary-button"
                          onClick={() => openMarkPaidModal(appointment)}
                        >
                          Mark paid
                        </button>
                      ) : (
                        <span className="paid-badge" aria-label="Appointment paid">
                          <span className="paid-badge-check" aria-hidden="true">
                            ✓
                          </span>
                          <span>Paid</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {invoiceQueueAppointments.length === 0 ? (
                <p className="empty-state">No completed or billed appointments are ready to invoice.</p>
              ) : null}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Upcoming</p>
                <h2>Appointments in the next week</h2>
              </div>
            </div>
            <div className="queue-list">
              {upcomingAppointmentQueue.map(({ appointment, customer }) => {
                const lastReminder = latestAppointmentReminderByAppointmentId.get(appointment.id)

                return (
                  <div key={appointment.id} className="queue-card">
                    <div>
                      <button
                        type="button"
                        className="inline-link-button workflow-name-link"
                        onClick={() => openCustomerDetailsFromWorkflow(customer.id)}
                      >
                        {customer.name}
                      </button>
                      <span>{fullDate(appointment.appointmentDate)}</span>
                      <span>{customer.address || 'No address on file'}</span>
                      <span>
                        {lastReminder
                          ? `Last reminder ${communicationChannelLabel(lastReminder.channel).toLowerCase()} ${shortDate(lastReminder.createdAt)}`
                          : 'No reminder sent yet'}
                      </span>
                    </div>
                    <div className="button-row">
                      <button
                        className="secondary-button"
                        onClick={() => openAppointmentDetails(appointment)}
                      >
                        Appt
                      </button>
                      {customerCanUseChannel(customer, 'email') ? (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            openUpcomingAppointmentReminderComposer('email', customer, appointment)
                          }
                        >
                          Email
                        </button>
                      ) : null}
                      {customerCanUseChannel(customer, 'sms') ? (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            openUpcomingAppointmentReminderComposer('sms', customer, appointment)
                          }
                        >
                          Text
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
              {upcomingAppointmentQueue.length === 0 ? (
                <p className="empty-state">No upcoming scheduled appointments in the next week.</p>
              ) : null}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Reminders</p>
                <h2>Customers due for the next tuning</h2>
              </div>
            </div>
            <div className="queue-list">
              {reminderQueue.map(({ customer, lastService, dueDate }) => (
                <div key={customer.id} className="queue-card">
                  <div>
                    <button
                      type="button"
                      className="inline-link-button workflow-name-link"
                      onClick={() => openCustomerDetailsFromWorkflow(customer.id)}
                    >
                      {customer.name}
                    </button>
                    <span>Last service {shortDate(lastService.appointmentDate)}</span>
                    <span>Reminder due {shortDate(dueDate.toISOString())}</span>
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      onClick={() => openAppointmentDetails(lastService)}
                    >
                      Appt
                    </button>
                    {customerCanUseChannel(customer, 'email') ? (
                      <button
                        className="secondary-button"
                        onClick={() => openRecurringReminderComposer('email', customer, lastService)}
                      >
                        Email
                      </button>
                    ) : null}
                    {customerCanUseChannel(customer, 'sms') ? (
                      <button
                        className="secondary-button"
                        onClick={() => openRecurringReminderComposer('sms', customer, lastService)}
                      >
                        Text
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Follow-up</p>
                <h2>Post-appointment check-ins</h2>
              </div>
            </div>
            <div className="queue-list">
              {followUpQueue.map(({ appointment, customer }) => (
                <div key={appointment.id} className="queue-card">
                  <div>
                    <button
                      type="button"
                      className="inline-link-button workflow-name-link"
                      onClick={() => openCustomerDetailsFromWorkflow(customer.id)}
                    >
                      {customer.name}
                    </button>
                    <span>Service date {shortDate(appointment.appointmentDate)}</span>
                    <span>Follow-up window {customer.followUpWeeks} weeks</span>
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      onClick={() => openAppointmentDetails(appointment)}
                    >
                      Appt
                    </button>
                    {customerCanUseChannel(customer, 'email') ? (
                      <button
                        className="secondary-button"
                        onClick={() => openFollowUpComposer('email', customer, appointment)}
                      >
                        Email
                      </button>
                    ) : null}
                    {customerCanUseChannel(customer, 'sms') ? (
                      <button
                        className="secondary-button"
                        onClick={() => openFollowUpComposer('sms', customer, appointment)}
                      >
                        Text
                      </button>
                    ) : null}
                    <button
                      className="ghost-button danger"
                      onClick={() => queueCancelFollowUpConfirmation(appointment)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
              {followUpQueue.length === 0 ? (
                <p className="empty-state">No follow-up reminders are waiting right now.</p>
              ) : null}
            </div>
          </article>

          <article className="panel communication-log-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Communication Log</p>
                <h2>Recent sent customer messages</h2>
              </div>
              <span>{filteredCommunicationLogs.length} shown</span>
            </div>
            <div className="customer-directory-controls">
              <input
                placeholder="Search customer, recipient, subject, message, channel"
                value={filters.communicationSearch}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    communicationSearch: event.target.value,
                  }))
                }
              />
            </div>
            <div className="queue-list communication-log-list">
              {filteredCommunicationLogs.slice(0, 40).map((item) => {
                const customer = item.customerId ? customerMap.get(item.customerId) : null
                const appointment = item.appointmentId
                  ? appointments.find((candidate) => candidate.id === item.appointmentId) ?? null
                  : null

                return (
                  <div key={item.id} className="queue-card communication-log-row">
                    <div>
                      {customer ? (
                        <button
                          type="button"
                          className="inline-link-button workflow-name-link"
                          onClick={() => openCustomerDetailsFromWorkflow(customer.id)}
                        >
                          {customer.name}
                        </button>
                      ) : (
                        <strong>{appointment?.customerName || item.recipient}</strong>
                      )}
                      <span>
                        {communicationChannelLabel(item.channel)} • {communicationKindLabel(item.kind)} • {fullDate(item.createdAt)}
                      </span>
                      <span>
                        To: {item.recipient}
                        {item.subject ? ` • ${item.subject}` : ''}
                      </span>
                      <span>{communicationPreview(item.body).slice(0, 220)}</span>
                    </div>
                    {appointment ? (
                      <div className="button-row">
                        <button
                          className="secondary-button"
                          onClick={() => openAppointmentDetails(appointment)}
                        >
                          Appt
                        </button>
                        {appointment.status !== 'paid' ? (
                          <button
                            className="secondary-button"
                            onClick={() => openMarkPaidModal(appointment)}
                          >
                            Mark paid
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {filteredCommunicationLogs.length === 0 ? (
                <p className="empty-state">
                  {filters.communicationSearch
                    ? 'No sent communications match that search.'
                    : 'No customer communications have been sent yet.'}
                </p>
              ) : null}
            </div>
          </article>

          <article className="panel" hidden>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Marketing</p>
                <h2>Exclude recently serviced customers</h2>
              </div>
              <label className="compact-label">
                Exclude serviced in last
                <input
                  type="number"
                  min="1"
                  value={filters.serviceWindowMonths}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      serviceWindowMonths: Number(event.target.value),
                    }))
                  }
                />
                months
              </label>
            </div>
            <div className="marketing-meta">
              <span>{marketingTargets.length} customers eligible</span>
              <button
                className="ghost-button"
                onClick={async () => {
                  const recipients = marketingTargets
                    .map((customer) => customer.email)
                    .filter(Boolean)
                    .join(',')
                  if (!recipients) {
                    setErrorText('None of the eligible customers have email addresses.')
                    return
                  }

                  const message = marketingText()
                  const updated = await runTask('Sending marketing blast…', async () => {
                    await sendMarketingBlast({
                      to: marketingTargets
                        .map((customer) => customer.email)
                        .filter(Boolean),
                      subject: `${settings.businessName} special offer`,
                      text: message,
                      html: marketingHtml(),
                      customerIds: marketingTargets.map((customer) => customer.id),
                    })
                    return markMarketingSent(marketingTargets.map((customer) => customer.id))
                  })
                  if (updated) {
                    await refreshData()
                    setStatusText('Marketing blast sent through Resend.')
                  }
                }}
              >
                Send email blast
              </button>
            </div>
            <div className="customer-list compact">
              {marketingTargets.map((customer) => {
                const lastService = lastServiceForCustomer(customer.id)
                return (
                  <div key={customer.id} className="customer-card static">
                    <div>
                      <strong>{customer.name}</strong>
                      <span>{customer.email || customer.phone || 'No contact method recorded'}</span>
                    </div>
                    <span>
                      {lastService ? `Last tuned ${shortDate(lastService.appointmentDate)}` : 'No service yet'}
                    </span>
                  </div>
                )
              })}
            </div>
          </article>
        </section>
      ) : null}

      {messageComposer ? (
        <div
          className="composer-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="composer-title"
        >
          <div className="composer-modal">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Review Message</p>
                <h2 id="composer-title">
                  {messageComposer.channel === 'email' ? 'Confirm email' : 'Confirm text'}
                </h2>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setMessageComposer(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleComposerSend()}
                  disabled={loading}
                >
                  {messageComposer.kind === 'follow_up' && messageComposer.channel === 'sms'
                    ? 'Open Messages'
                    : 'Send now'}
                </button>
              </div>
            </div>
            <p className="composer-note">
              {messageComposer.kind === 'follow_up' && messageComposer.channel === 'sms'
                ? 'This will open the device messaging app so replies come back to the phone instead of the cloud texting service.'
                : `This will be sent via the configured cloud ${messageComposer.channel === 'email' ? 'email' : 'text'} service.`}
            </p>
            {messageComposer.headerDetails?.length ? (
              <div className="composer-header-grid">
                <div className="detail-card composer-header-card composer-header-block">
                  {messageComposer.headerDetails.map((item) => (
                    <div key={`${item.label}-${item.value}`} className="composer-header-row">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="full-width">
              To
              <input value={messageComposer.recipient} readOnly />
            </label>
            {messageComposer.channel === 'email' ? (
              <label className="full-width">
                Subject
                <input
                  value={messageComposer.subject}
                  onChange={(event) =>
                    setMessageComposer((current) =>
                      current ? { ...current, subject: event.target.value } : current,
                    )
                  }
                />
              </label>
            ) : null}
            <label className="full-width">
              Message
              <textarea
                rows={messageComposer.channel === 'email' ? 14 : 10}
                value={messageComposer.message}
                onChange={(event) =>
                  setMessageComposer((current) =>
                    current ? { ...current, message: event.target.value } : current,
                  )
                }
              />
            </label>
          </div>
        </div>
      ) : null}

      {appointmentChannelPrompt ? (
        <div
          className="composer-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="appointment-channel-title"
        >
          <div className="composer-modal channel-prompt-modal">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Appointment</p>
                <h2 id="appointment-channel-title">Send confirmation</h2>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setAppointmentChannelPrompt(null)
                  setStatusText(`Saved appointment for ${appointmentChannelPrompt.customer.name}.`)
                }}
              >
                Skip for now
              </button>
            </div>
            <p className="composer-note">
              Choose how you want to send the appointment confirmation, then we will open the editable message review.
            </p>
            <div className="composer-header-grid">
              <div className="detail-card composer-header-card composer-header-block">
                {appointmentCommunicationDetails(
                  appointmentChannelPrompt.customer,
                  appointmentChannelPrompt.appointment,
                ).map((item) => (
                  <div key={`${item.label}-${item.value}`} className="composer-header-row">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="button-row">
              {customerCanUseChannel(appointmentChannelPrompt.customer, 'email') ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    openAppointmentConfirmationComposer(
                      'email',
                      appointmentChannelPrompt.customer,
                      appointmentChannelPrompt.appointment,
                    )
                    setAppointmentChannelPrompt(null)
                  }}
                >
                  Send by email
                </button>
              ) : null}
              {customerCanUseChannel(appointmentChannelPrompt.customer, 'sms') ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    openAppointmentConfirmationComposer(
                      'sms',
                      appointmentChannelPrompt.customer,
                      appointmentChannelPrompt.appointment,
                    )
                    setAppointmentChannelPrompt(null)
                  }}
                >
                  Send by text
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {markPaidState ? (
        <div
          className="composer-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mark-paid-title"
        >
          <div className="composer-modal mark-paid-modal">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Payment</p>
                <h2 id="mark-paid-title">Mark appointment paid</h2>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setMarkPaidState(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleMarkPaid()}
                  disabled={loading}
                >
                  Save payment
                </button>
              </div>
            </div>
            {(() => {
              const appointment = appointments.find(
                (item) => item.id === markPaidState.appointmentId,
              )

              return appointment ? (
                <div className="mark-paid-body">
                  <p className="composer-note">
                    This will update the appointment to <strong>paid</strong> and store the
                    selected payment method.
                  </p>
                  <div className="detail-grid">
                    <div className="detail-card">
                      <span>Customer</span>
                      <strong>{appointment.customerName}</strong>
                    </div>
                    <div className="detail-card">
                      <span>Appointment</span>
                      <strong>{fullDate(appointment.appointmentDate)}</strong>
                    </div>
                    <div className="detail-card">
                      <span>Total due</span>
                      <strong>{currency(totalForAppointment(appointment))}</strong>
                    </div>
                  </div>
                  <label className="full-width">
                    Payment method
                    <select
                      value={markPaidState.paymentMethod}
                      onChange={(event) =>
                        setMarkPaidState((current) =>
                          current
                            ? {
                                ...current,
                                paymentMethod: event.target.value as PaymentMethod,
                              }
                            : current,
                        )
                      }
                    >
                      <option value="cash">Cash</option>
                      <option value="check">Check</option>
                      <option value="venmo">Venmo</option>
                    </select>
                  </label>
                </div>
              ) : null
            })()}
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <div
          className="composer-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div className="composer-modal mark-paid-modal">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Confirmation</p>
                <h2 id="confirm-dialog-title">{confirmDialog.title}</h2>
              </div>
            </div>
            <p className="composer-note">{confirmDialog.message}</p>
            <div className="button-row">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setConfirmDialog(null)}
              >
                No
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleConfirmDialogYes()}
                disabled={loading}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'settings' ? (
        <section className="workspace-grid single">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Business defaults</p>
                <h2>Settings</h2>
              </div>
            </div>
            <form className="form-grid" onSubmit={handleSettingsSave}>
              <label>
                Business name
                <input
                  value={settings.businessName}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, businessName: event.target.value }))
                  }
                />
              </label>
              <label>
                Website
                <input
                  placeholder="https://www.primepianos.com"
                  value={settings.websiteUrl}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, websiteUrl: event.target.value }))
                  }
                />
              </label>
              <label>
                Venmo handle
                <input
                  placeholder="@yourhandle"
                  value={settings.venmoHandle}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, venmoHandle: event.target.value }))
                  }
                />
              </label>
              <label>
                Voice number
                <input
                  placeholder="(253) 900-9540"
                  value={settings.voicePhone}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, voicePhone: event.target.value }))
                  }
                />
              </label>
              <label>
                Travel charge
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settings.defaultTravelCharge}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      defaultTravelCharge: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Pitch raise charge
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settings.defaultPitchRaiseCharge}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      defaultPitchRaiseCharge: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Voicing charge
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settings.defaultVoicingCharge}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      defaultVoicingCharge: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Default tax rate
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={settings.defaultTaxRate}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      defaultTaxRate: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Default reminder months
                <input
                  type="number"
                  min="1"
                  value={settings.defaultReminderMonths}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      defaultReminderMonths: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Default follow-up weeks
                <input
                  type="number"
                  min="1"
                  value={settings.defaultFollowUpWeeks}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      defaultFollowUpWeeks: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Marketing exclusion months
                <input
                  type="number"
                  min="1"
                  value={settings.marketingExcludeMonths}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      marketingExcludeMonths: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label className="full-width">
                Email signature
                <textarea
                  rows={4}
                  value={settings.emailSignature}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, emailSignature: event.target.value }))
                  }
                />
              </label>
              <label className="full-width">
                SMS signature
                <textarea
                  rows={3}
                  value={settings.smsSignature}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, smsSignature: event.target.value }))
                  }
                />
              </label>
              <button type="submit" className="primary-button" disabled={loading}>
                Save settings
              </button>
            </form>
          </article>
        </section>
      ) : null}

      {activeTab === 'backup' ? (
        <section className="workspace-grid single">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Resilience</p>
                <h2>Data backup</h2>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleBackupDownload()}
                  disabled={loading}
                >
                  Download backup JSON
                </button>
              </div>
            </div>
            <div className="message-stack">
              <p className="composer-note">
                Export a snapshot of your current Back4App data into a versioned JSON file that can
                be used for disaster recovery or later restore work.
              </p>
              <div className="detail-grid">
                <article className="detail-card backup-summary-card">
                  <span>Included data</span>
                  <strong>Customers, appointments, communication log, and settings</strong>
                </article>
                <article className="detail-card backup-summary-card">
                  <span>Export source</span>
                  <strong>Live Back4App / Parse data</strong>
                </article>
                <article className="detail-card backup-summary-card">
                  <span>Restore UI</span>
                  <strong>Disabled for safety</strong>
                </article>
              </div>
              <div className="detail-card accent">
                <h3>Restore is intentionally disabled</h3>
                <p className="composer-note">
                  The restore engine exists in the data layer, but the UI is disabled for now so no
                  one can accidentally overwrite production data. When we enable it later, we should
                  treat restore as a deliberate admin-only recovery action.
                </p>
              </div>
              <div className="detail-card">
                <h3>About local backups</h3>
                <p className="composer-note">
                  This backup file is an export and restore artifact, not a live offline data store.
                  The app still runs against Parse today. Switching the app to operate directly from
                  a local JSON backup would require a separate local persistence mode.
                </p>
              </div>
              <div className="button-row">
                <button type="button" className="secondary-button" disabled>
                  Restore from backup
                </button>
              </div>
            </div>
          </article>
        </section>
      ) : null}
    </main>
  )
}

export default App

