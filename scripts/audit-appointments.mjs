import Parse from 'parse/node.js'

function printUsage() {
  console.log('Usage: npm run audit:appointments -- <username> <password>')
  console.log('Example: npm run audit:appointments -- admin YourPassword')
}

const [, , ...args] = process.argv

if (args.includes('--help') || args.includes('-h')) {
  printUsage()
  process.exit(0)
}

if (args.length < 2) {
  printUsage()
  process.exit(1)
}

const [username, password] = args
const appId = process.env.VITE_PARSE_APP_ID
const javascriptKey = process.env.VITE_PARSE_JAVASCRIPT_KEY
const serverURL = process.env.VITE_PARSE_SERVER_URL || 'https://parseapi.back4app.com/'

const missing = [
  ['VITE_PARSE_APP_ID', appId],
  ['VITE_PARSE_JAVASCRIPT_KEY', javascriptKey],
].filter(([, value]) => !value)

if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.map(([key]) => key).join(', ')}`)
  process.exit(1)
}

Parse.initialize(appId, javascriptKey)
Parse.serverURL = serverURL

function describeValue(value) {
  if (value instanceof Date) {
    return {
      type: 'Date',
      value: Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString(),
    }
  }

  if (value === undefined) {
    return { type: 'undefined', value: '' }
  }

  if (value === null) {
    return { type: 'null', value: '' }
  }

  return { type: typeof value, value: String(value) }
}

function parseableDate(value) {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime())
  }

  if (typeof value === 'string') {
    return !Number.isNaN(new Date(value).getTime())
  }

  return false
}

function toIsoDate(value) {
  if (value instanceof Date) {
    return value.toISOString()
  }

  return new Date(value).toISOString()
}

function appointmentSnapshot(object, appointmentDateValue, reason) {
  return {
    objectId: object.id,
    customerName: object.get('customerName') ?? '',
    status: object.get('status') ?? '',
    appointmentDate: appointmentDateValue,
    createdAt: object.createdAt?.toISOString() ?? '',
    updatedAt: object.updatedAt?.toISOString() ?? '',
    reason,
  }
}

async function fetchAllAppointments(sessionToken) {
  const pageSize = 500
  let skip = 0
  const appointments = []

  while (true) {
    const query = new Parse.Query('Appointment')
    query.limit(pageSize)
    query.skip(skip)
    query.ascending('createdAt')
    const batch = await query.find({ sessionToken })
    appointments.push(...batch)

    if (batch.length < pageSize) {
      break
    }

    skip += batch.length
  }

  return appointments
}

async function main() {
  const user = await Parse.User.logIn(username, password)
  const sessionToken = user.getSessionToken()

  if (!sessionToken) {
    throw new Error('Login succeeded, but no Parse session token was returned.')
  }

  const appointments = await fetchAllAppointments(sessionToken)
  const todayKey = new Date().toISOString().slice(0, 10)
  const malformed = []
  const suspicious = []

  for (const appointment of appointments) {
    const rawDate = appointment.get('appointmentDate')
    const described = describeValue(rawDate)

    if (!parseableDate(rawDate)) {
      malformed.push(appointmentSnapshot(
        appointment,
        `${described.type}${described.value ? `: ${described.value}` : ''}`,
        'appointmentDate is missing or not parseable',
      ))
      continue
    }

    const isoDate = toIsoDate(rawDate)
    const createdKey = appointment.createdAt?.toISOString().slice(0, 10) ?? ''
    const appointmentKey = isoDate.slice(0, 10)

    if (appointmentKey === todayKey) {
      suspicious.push(appointmentSnapshot(
        appointment,
        isoDate,
        'appointmentDate is today',
      ))
      continue
    }

    if (createdKey && appointmentKey === createdKey) {
      suspicious.push(appointmentSnapshot(
        appointment,
        isoDate,
        'appointmentDate is the same calendar day as createdAt',
      ))
    }
  }

  console.log(`Checked ${appointments.length} appointments.`)
  console.log(`Malformed appointmentDate values: ${malformed.length}`)
  console.log(`Suspicious appointmentDate values: ${suspicious.length}`)

  if (malformed.length > 0) {
    console.log('\nMalformed records:')
    console.table(malformed)
  }

  if (suspicious.length > 0) {
    console.log('\nSuspicious records:')
    console.table(suspicious)
  }
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
