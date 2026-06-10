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
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  subMonths,
  subQuarters,
} from 'date-fns'
import './App.css'
import {
  deleteAppointment,
  deleteCustomer,
  fetchAppointments,
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
  saveAppointment,
  saveCustomer,
  saveSettings,
  sendBusinessEmail,
  sendBusinessSms,
  sendMarketingBlast,
} from './lib/parse'
import {
  defaultSettings,
  type AppointmentInput,
  type AppointmentRecord,
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
  ['workflows', 'Workflows'],
  ['settings', 'Settings'],
] as const

const emptyCustomerForm = (settings: BusinessSettings): CustomerInput => ({
  name: '',
  address: '',
  email: '',
  phone: '',
  reminderOptIn: true,
  reminderMonths: settings.defaultReminderMonths,
  followUpWeeks: settings.defaultFollowUpWeeks,
  marketingOptIn: true,
  notes: '',
})

function defaultAppointmentDateTime() {
  const date = new Date()
  date.setHours(10, 0, 0, 0)
  return format(date, "yyyy-MM-dd'T'HH:mm")
}

const emptyAppointmentForm = (): AppointmentInput => ({
  customerId: '',
  customerName: '',
  appointmentDate: defaultAppointmentDateTime(),
  quotedEstimate: 0,
  travelCharge: 0,
  additionalCharges: 0,
  additionalChargeNote: '',
  taxAmount: 0,
  notes: '',
  status: 'scheduled',
})

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

function fullDate(value: string) {
  return format(parseISO(value), 'MMM d, yyyy h:mm a')
}

function shortDate(value: string) {
  return format(parseISO(value), 'MMM d, yyyy')
}

function calendarEventClass(status: AppointmentStatus) {
  return `calendar-event status-${status}`
}

function parseAppointmentDateTime(value: string) {
  const [datePart = format(new Date(), 'yyyy-MM-dd'), timePart = '10:00'] = value.split('T')
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
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

function App() {
  const appVersion = __APP_VERSION__
  const [user, setUser] = useState(() => getCurrentUser())
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([])
  const [settings, setSettings] = useState<BusinessSettings>(defaultSettings)
  const [customerForm, setCustomerForm] = useState<CustomerInput>(emptyCustomerForm(defaultSettings))
  const [appointmentForm, setAppointmentForm] = useState<AppointmentInput>(emptyAppointmentForm())
  const [activeTab, setActiveTab] =
    useState<(typeof navigation)[number][0]>('customers')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()))
  const [isCustomerFormOpen, setIsCustomerFormOpen] = useState(false)
  const [isAppointmentFormOpen, setIsAppointmentFormOpen] = useState(false)
  const [isAppointmentEditing, setIsAppointmentEditing] = useState(false)
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('')
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [filters, setFilters] = useState({
    customerSearch: '',
    serviceHistorySearch: '',
    serviceWindowMonths: defaultSettings.marketingExcludeMonths,
  })
  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState('Ready.')
  const [errorText, setErrorText] = useState('')

  const refreshData = useEffectEvent(async () => {
    const [nextCustomers, nextAppointments, nextSettings] = await Promise.all([
      fetchCustomers(),
      fetchAppointments(),
      fetchSettings(),
    ])

    setCustomers(nextCustomers)
    setAppointments(nextAppointments)
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
      if (appointment.status === 'scheduled' || appointment.followUpSentAt) {
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

  const quarterSummary = quartersFromAppointments(appointments)
  const currentQuarter = quarterSummary[0] ?? { sales: 0, tax: 0, count: 0, label: 'This quarter' }
  const outstandingInvoices = appointments.filter(
    (appointment) => appointment.status !== 'paid',
  )
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
  const totalSales = completedAppointments.reduce(
    (sum, appointment) =>
      sum + appointment.quotedEstimate + appointment.travelCharge + appointment.additionalCharges,
    0,
  )
  const totalTaxCollected = completedAppointments.reduce(
    (sum, appointment) => sum + appointment.taxAmount,
    0,
  )
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

    const payload: AppointmentInput = {
      ...appointmentForm,
      customerName: selected.name,
    }

    const saved = await runTask('Saving appointment…', () => saveAppointment(payload))
    if (saved) {
      await refreshData()
      setAppointmentForm({
        id: saved.id,
        customerId: saved.customerId,
        customerName: saved.customerName,
        appointmentDate: saved.appointmentDate.slice(0, 16),
        quotedEstimate: saved.quotedEstimate,
        travelCharge: saved.travelCharge,
        additionalCharges: saved.additionalCharges,
        additionalChargeNote: saved.additionalChargeNote,
        taxAmount: saved.taxAmount,
        notes: saved.notes,
        status: saved.status,
      })
      setSelectedAppointmentId(saved.id)
      setIsAppointmentFormOpen(true)
      setIsAppointmentEditing(false)
      setSelectedCustomerId(selected.id)
      setStatusText(`Saved appointment for ${selected.name}.`)
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

  function editCustomer(customer: CustomerRecord) {
    setCustomerForm({
      id: customer.id,
      name: customer.name,
      address: customer.address,
      email: customer.email,
      phone: customer.phone,
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
    setAppointmentForm({
      id: appointment.id,
      customerId: appointment.customerId,
      customerName: appointment.customerName,
      appointmentDate: appointment.appointmentDate.slice(0, 16),
      quotedEstimate: appointment.quotedEstimate,
      travelCharge: appointment.travelCharge,
      additionalCharges: appointment.additionalCharges,
      additionalChargeNote: appointment.additionalChargeNote,
      taxAmount: appointment.taxAmount,
      notes: appointment.notes,
      status: appointment.status,
    })
  }

  function openAppointmentDetails(appointment: AppointmentRecord) {
    loadAppointmentIntoForm(appointment)
    setSelectedAppointmentId(appointment.id)
    setIsAppointmentFormOpen(true)
    setIsAppointmentEditing(false)
    setSelectedCustomerId(appointment.customerId)
    setActiveTab('appointments')
  }

  function beginAppointmentEdit(appointment: AppointmentRecord) {
    loadAppointmentIntoForm(appointment)
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
    setIsAppointmentFormOpen(false)
    setIsAppointmentEditing(false)
    setSelectedAppointmentId('')
  }

  function startNewAppointment(customer?: CustomerRecord | null) {
    setAppointmentForm({
      ...emptyAppointmentForm(),
      customerId: customer?.id ?? '',
      customerName: customer?.name ?? '',
    })
    setSelectedCustomerId(customer?.id ?? '')
    setSelectedAppointmentId('')
    setIsAppointmentFormOpen(true)
    setIsAppointmentEditing(true)
    setActiveTab('appointments')
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
    const venmoLink = settings.venmoHandle
      ? `https://venmo.com/${settings.venmoHandle}?txn=pay&amount=${totalForAppointment(appointment).toFixed(2)}&note=${encodeURIComponent(`Piano tuning on ${shortDate(appointment.appointmentDate)}`)}`
      : 'Add your Venmo handle in Settings to generate a payment link.'

    return [
      `Hi ${appointment.customerName},`,
      '',
      `Thanks for scheduling your piano tuning appointment on ${shortDate(appointment.appointmentDate)}.`,
      `Quoted estimate: ${currency(appointment.quotedEstimate)}`,
      `Travel charge: ${currency(appointment.travelCharge)}`,
      `Additional charges: ${currency(appointment.additionalCharges)}`,
      appointment.additionalChargeNote
        ? `Additional charge note: ${appointment.additionalChargeNote}`
        : null,
      `Tax: ${currency(appointment.taxAmount)}`,
      `Total: ${currency(totalForAppointment(appointment))}`,
      '',
      `Pay with Venmo: ${venmoLink}`,
      '',
      settings.emailSignature,
    ]
      .filter(Boolean)
      .join('\n')
  }

  function asHtml(text: string) {
    return text
      .split('\n\n')
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
      .join('')
  }

  function reminderText(customer: CustomerRecord, appointment: AppointmentRecord) {
    return [
      `Hi ${customer.name},`,
      '',
      `It has been ${differenceInCalendarDays(new Date(), parseISO(appointment.appointmentDate))} days since your last piano tuning on ${shortDate(appointment.appointmentDate)}.`,
      'Would you like to get your next tuning on the calendar?',
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
            <h1>Prime Pianos Customer Management</h1>
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
    <main className="app-shell">
      <section className="app-banner">
        <div className="app-banner-copy">
          <h1>Prime Pianos Customer Management</h1>
          <span className="app-version">v{appVersion}</span>
        </div>
        <button className="ghost-button" onClick={handleLogout}>
          Log out
        </button>
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

      <section className="status-banner">
        <p>{statusText}</p>
        <p>{loading ? 'Working…' : 'Synced.'}</p>
      </section>
      {errorText ? <p className="error-text">{errorText}</p> : null}

      {activeTab === 'reports' ? (
        <>
          <section className="stats-grid">
            <StatCard
              label="Total sales"
              value={currency(totalSales)}
              detail={`${completedAppointments.length} completed or billed appointments`}
            />
            <StatCard
              label="Total tax collected"
              value={currency(totalTaxCollected)}
              detail="Sum of all recorded tax amounts"
            />
            <StatCard
              label={currentQuarter.label}
              value={currency(currentQuarter.sales)}
              detail={`${currency(currentQuarter.tax)} tax collected this quarter`}
            />
            <StatCard
              label="Outstanding invoices"
              value={String(outstandingInvoices.length)}
              detail={`${currency(outstandingInvoices.reduce((sum, appointment) => sum + totalForAppointment(appointment), 0))} not marked paid`}
            />
          </section>

          <section className="overview-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Pipeline</p>
                  <h2>Upcoming attention</h2>
                </div>
              </div>
              <div className="queue-list">
                {appointments.slice(0, 5).map((appointment) => (
                  <button
                    key={appointment.id}
                    className="queue-card"
                    onClick={() => openAppointmentDetails(appointment)}
                  >
                    <strong>{appointment.customerName}</strong>
                    <span>{fullDate(appointment.appointmentDate)}</span>
                    <span>
                      {appointment.status} • {currency(totalForAppointment(appointment))}
                    </span>
                  </button>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Taxes</p>
                  <h2>Quarterly filing snapshot</h2>
                </div>
              </div>
              <div className="quarter-list">
                {quarterSummary.map((quarter) => (
                  <div key={quarter.label} className="quarter-row">
                    <strong>{quarter.label}</strong>
                    <span>{currency(quarter.sales)} sales</span>
                    <span>{currency(quarter.tax)} tax</span>
                    <span>{quarter.count} appointments</span>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}

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
                    onClick={() => setSelectedCustomerId('')}
                  >
                    Back to directory
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => editCustomer(selectedVisibleCustomer)}
                  >
                    Edit
                  </button>
                  <button
                    className="ghost-button danger"
                    onClick={() => handleDeleteCustomer(selectedVisibleCustomer.id)}
                  >
                    Delete
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
                        onClick={() => startNewAppointment(selectedVisibleCustomer)}
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
                          onClick={() => openAppointmentDetails(appointment)}
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
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Directory</p>
                  <h2>Customers</h2>
                </div>
                <div className="customer-toolbar">
                  <input
                    placeholder="Search name, phone, email, address"
                    value={filters.customerSearch}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, customerSearch: event.target.value }))
                    }
                  />
                  <button className="secondary-button" onClick={startNewCustomer}>
                    Add customer
                  </button>
                  <span className="customer-search-meta">
                    {filteredCustomers.length} of {customers.length}
                  </span>
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
                    <button
                      key={customer.id}
                      className="customer-card"
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
              label="Total sales"
              value={currency(totalSales)}
              detail={`${completedAppointments.length} completed or billed appointments`}
            />
            <StatCard
              label="Total tax collected"
              value={currency(totalTaxCollected)}
              detail="Sum of all recorded tax amounts"
            />
            <StatCard
              label={currentQuarter.label}
              value={currency(currentQuarter.sales)}
              detail={`${currency(currentQuarter.tax)} tax collected this quarter`}
            />
            <StatCard
              label="Outstanding invoices"
              value={String(outstandingInvoices.length)}
              detail={`${currency(outstandingInvoices.reduce((sum, appointment) => sum + totalForAppointment(appointment), 0))} not marked paid`}
            />
          </section>

          <section className="reports-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Taxes</p>
                  <h2>Quarterly filing snapshot</h2>
                </div>
              </div>
              <div className="quarter-list">
                {quarterSummary.map((quarter) => (
                  <div key={quarter.label} className="quarter-row">
                    <strong>{quarter.label}</strong>
                    <span>{currency(quarter.sales)} sales</span>
                    <span>{currency(quarter.tax)} tax</span>
                    <span>{quarter.count} appointments</span>
                  </div>
                ))}
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
                    className="queue-card"
                    onClick={() => openAppointmentDetails(appointment)}
                  >
                    <strong>{appointment.customerName}</strong>
                    <span>{fullDate(appointment.appointmentDate)}</span>
                    <span>
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
                onClick={() => startNewAppointment(selectedCustomer)}
              >
                New appointment
              </button>
            </div>

            <div className="appointments-dashboard">
              <section className="schedule-block">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">Coming up</p>
                    <h3>Next 2 weeks</h3>
                  </div>
                  <span>{nextTwoWeeksAppointments.length} scheduled</span>
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
                            onClick={() => openAppointmentDetails(appointment)}
                          >
                            <td>{fullDate(appointment.appointmentDate)}</td>
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
                              onClick={() => openAppointmentDetails(appointment)}
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
                <div key={appointment.id} className="appointment-card">
                  <button
                    type="button"
                    className="appointment-main"
                    onClick={() => openAppointmentDetails(appointment)}
                  >
                    <strong>{appointment.customerName}</strong>
                    <span>{fullDate(appointment.appointmentDate)}</span>
                    <span>
                      {appointment.status} • {currency(totalForAppointment(appointment))}
                    </span>
                  </button>
                  <button
                    className="ghost-button danger"
                    onClick={() => handleDeleteAppointment(appointment.id)}
                  >
                    Delete
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
                      onClick={() => setIsAppointmentEditing(false)}
                    >
                      Cancel
                    </button>
                  </>
                ) : selectedAppointment ? (
                  <>
                    <button type="button" className="ghost-button" onClick={resetAppointmentForm}>
                      Back to calendar
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        selectedAppointment ? beginAppointmentEdit(selectedAppointment) : null
                      }
                    >
                      Edit
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
                  Additional charges
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
                  Additional charge note
                  <input
                    placeholder="What is this for?"
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
              </form>
            ) : selectedAppointment ? (
              <div className="detail-card appointment-detail-card">
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
                  <div className="summary-item">
                    <span>Quoted estimate</span>
                    <strong>{currency(selectedAppointment.quotedEstimate)}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Travel charge</span>
                    <strong>{currency(selectedAppointment.travelCharge)}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Additional charges</span>
                    <strong>{currency(selectedAppointment.additionalCharges)}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Additional charge note</span>
                    <strong>{selectedAppointment.additionalChargeNote || 'No additional charge note'}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Tax amount</span>
                    <strong>{currency(selectedAppointment.taxAmount)}</strong>
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
                <div key={appointment.id} className="appointment-card">
                  <button
                    type="button"
                    className="appointment-main"
                    onClick={() => openAppointmentDetails(appointment)}
                  >
                    <strong>{appointment.customerName}</strong>
                    <span>{fullDate(appointment.appointmentDate)}</span>
                    <span>
                      {appointment.status} • {currency(totalForAppointment(appointment))}
                    </span>
                  </button>
                  <button
                    className="ghost-button danger"
                    onClick={() => handleDeleteAppointment(appointment.id)}
                  >
                    Delete
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
              {appointments.slice(0, 8).map((appointment) => (
                <div key={appointment.id} className="queue-card">
                  <div>
                    <strong>{appointment.customerName}</strong>
                    <span>{currency(totalForAppointment(appointment))}</span>
                    <span>
                      {appointment.invoiceSentAt
                        ? `Last sent ${shortDate(appointment.invoiceSentAt)}`
                        : 'Not sent yet'}
                    </span>
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      onClick={() => {
                        const customer = customerMap.get(appointment.customerId)
                        if (!customer?.email) {
                          setErrorText('This customer does not have an email address.')
                          return
                        }
                        const message = invoiceText(appointment)
                        void runTask('Sending invoice email…', async () => {
                          await sendBusinessEmail({
                            to: customer.email,
                            subject: `Invoice from ${settings.businessName}`,
                            text: message,
                            html: asHtml(message),
                            customerId: customer.id,
                            appointmentId: appointment.id,
                            kind: 'invoice',
                          })
                          await markInvoiceSent(appointment.id)
                          await refreshData()
                          setStatusText(`Invoice email sent to ${customer.name}.`)
                        })
                      }}
                    >
                      Email
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        const customer = customerMap.get(appointment.customerId)
                        if (!customer?.phone) {
                          setErrorText('This customer does not have a phone number.')
                          return
                        }
                        const message = invoiceText(appointment)
                        void runTask('Sending invoice text…', async () => {
                          await sendBusinessSms({
                            to: customer.phone,
                            body: message,
                            customerId: customer.id,
                            appointmentId: appointment.id,
                            kind: 'invoice',
                          })
                          await markInvoiceSent(appointment.id)
                          await refreshData()
                          setStatusText(`Invoice text sent to ${customer.name}.`)
                        })
                      }}
                    >
                      Text
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() =>
                        copyText(invoiceText(appointment), 'Invoice text copied to clipboard.')
                      }
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ))}
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
                    <strong>{customer.name}</strong>
                    <span>Last service {shortDate(lastService.appointmentDate)}</span>
                    <span>Reminder due {shortDate(dueDate.toISOString())}</span>
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      onClick={() => {
                        if (!customer.email) {
                          setErrorText('This customer does not have an email address.')
                          return
                        }
                        const message = reminderText(customer, lastService)
                        void runTask('Sending reminder email…', async () => {
                          await sendBusinessEmail({
                            to: customer.email,
                            subject: 'Time to schedule your next piano tuning',
                            text: message,
                            html: asHtml(message),
                            customerId: customer.id,
                            appointmentId: lastService.id,
                            kind: 'reminder',
                          })
                          await markReminderSent(customer.id)
                          await refreshData()
                          setStatusText(`Reminder email sent to ${customer.name}.`)
                        })
                      }}
                    >
                      Email
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        if (!customer.phone) {
                          setErrorText('This customer does not have a phone number.')
                          return
                        }
                        const message = reminderText(customer, lastService)
                        void runTask('Sending reminder text…', async () => {
                          await sendBusinessSms({
                            to: customer.phone,
                            body: message,
                            customerId: customer.id,
                            appointmentId: lastService.id,
                            kind: 'reminder',
                          })
                          await markReminderSent(customer.id)
                          await refreshData()
                          setStatusText(`Reminder text sent to ${customer.name}.`)
                        })
                      }}
                    >
                      Text
                    </button>
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
                    <strong>{customer.name}</strong>
                    <span>Service date {shortDate(appointment.appointmentDate)}</span>
                    <span>Follow-up window {customer.followUpWeeks} weeks</span>
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      onClick={() => {
                        if (!customer.email) {
                          setErrorText('This customer does not have an email address.')
                          return
                        }
                        const message = followUpText(customer, appointment)
                        void runTask('Sending follow-up email…', async () => {
                          await sendBusinessEmail({
                            to: customer.email,
                            subject: 'Checking in on your piano',
                            text: message,
                            html: asHtml(message),
                            customerId: customer.id,
                            appointmentId: appointment.id,
                            kind: 'follow_up',
                          })
                          await markFollowUpSent(appointment.id)
                          await refreshData()
                          setStatusText(`Follow-up email sent to ${customer.name}.`)
                        })
                      }}
                    >
                      Email
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        if (!customer.phone) {
                          setErrorText('This customer does not have a phone number.')
                          return
                        }
                        const message = followUpText(customer, appointment)
                        void runTask('Sending follow-up text…', async () => {
                          await sendBusinessSms({
                            to: customer.phone,
                            body: message,
                            customerId: customer.id,
                            appointmentId: appointment.id,
                            kind: 'follow_up',
                          })
                          await markFollowUpSent(appointment.id)
                          await refreshData()
                          setStatusText(`Follow-up text sent to ${customer.name}.`)
                        })
                      }}
                    >
                      Text
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
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
                      html: asHtml(message),
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
    </main>
  )
}

export default App
