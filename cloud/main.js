const Parse = require('parse/node')
const { Resend } = require('resend')

let cachedRuntimeConfig = null

async function getRuntimeConfig() {
  if (cachedRuntimeConfig) {
    return cachedRuntimeConfig
  }

  const parseConfig = await Parse.Config.get({ useMasterKey: true })

  cachedRuntimeConfig = {
    resendApiKey: process.env.RESEND_API_KEY || parseConfig.get('RESEND_API_KEY') || '',
    resendFromEmail: process.env.RESEND_FROM_EMAIL || parseConfig.get('RESEND_FROM_EMAIL') || '',
    resendReplyTo: process.env.RESEND_REPLY_TO || parseConfig.get('RESEND_REPLY_TO') || '',
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || parseConfig.get('TWILIO_ACCOUNT_SID') || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || parseConfig.get('TWILIO_AUTH_TOKEN') || '',
    twilioApiKeySid: process.env.TWILIO_API_KEY_SID || parseConfig.get('TWILIO_API_KEY_SID') || '',
    twilioApiKeySecret:
      process.env.TWILIO_API_KEY_SECRET || parseConfig.get('TWILIO_API_KEY_SECRET') || '',
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER || parseConfig.get('TWILIO_FROM_NUMBER') || '',
  }

  return cachedRuntimeConfig
}

function requireUser(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, 'You must be logged in.')
  }

  return request.user
}

function requireValue(value, label) {
  if (!value) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${label} is required.`)
  }
}

async function requireMessagingConfig() {
  const config = await getRuntimeConfig()

  requireValue(config.resendApiKey, 'RESEND_API_KEY')
  requireValue(config.resendFromEmail, 'RESEND_FROM_EMAIL')
  requireValue(config.twilioFromNumber, 'TWILIO_FROM_NUMBER')

  const hasAuthTokenFlow = Boolean(config.twilioAccountSid && config.twilioAuthToken)
  const hasApiKeyFlow = Boolean(
    config.twilioAccountSid && config.twilioApiKeySid && config.twilioApiKeySecret,
  )

  if (!hasAuthTokenFlow && !hasApiKeyFlow) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      'Twilio config is incomplete. Provide either TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN or TWILIO_ACCOUNT_SID + TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET.',
    )
  }
  return config
}

function getTwilioAuthorizationHeader(config) {
  if (config.twilioApiKeySid && config.twilioApiKeySecret) {
    return `Basic ${Buffer.from(`${config.twilioApiKeySid}:${config.twilioApiKeySecret}`).toString('base64')}`
  }

  return `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64')}`
}

async function saveCommunicationLog({
  request,
  channel,
  provider,
  kind,
  recipient,
  subject,
  body,
  customerId,
  appointmentId,
  providerMessageId,
}) {
  const log = new Parse.Object('CommunicationLog')
  const acl = new Parse.ACL(request.user)
  acl.setPublicReadAccess(false)
  acl.setPublicWriteAccess(false)

  log.setACL(acl)
  log.set('ownerId', request.user.id)
  log.set('ownerUsername', request.user.getUsername())
  log.set('channel', channel)
  log.set('provider', provider)
  log.set('kind', kind)
  log.set('recipient', recipient)
  log.set('subject', subject || '')
  log.set('body', body)
  log.set('customerId', customerId || '')
  log.set('appointmentId', appointmentId || '')
  log.set('providerMessageId', providerMessageId || '')
  await log.save(null, { useMasterKey: true })
}

async function sendSms({ to, body, config }) {
  const params = new URLSearchParams({
    To: to,
    From: config.twilioFromNumber,
    Body: body,
  })

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: getTwilioAuthorizationHeader(config),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    },
  )

  const data = await response.json()

  if (!response.ok) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      data.message || 'Twilio SMS send failed.',
    )
  }

  return data
}

Parse.Cloud.define('sendBusinessEmail', async (request) => {
  requireUser(request)
  const config = await requireMessagingConfig()

  const { to, subject, text, html, customerId, appointmentId, kind } = request.params

  requireValue(to, 'to')
  requireValue(subject, 'subject')
  requireValue(text, 'text')
  requireValue(kind, 'kind')

  const resend = new Resend(config.resendApiKey)
  const response = await resend.emails.send({
    from: config.resendFromEmail,
    to,
    replyTo: config.resendReplyTo || undefined,
    subject,
    text,
    html,
  })

  if (response.error) {
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, response.error.message)
  }

  await saveCommunicationLog({
    request,
    channel: 'email',
    provider: 'resend',
    kind,
    recipient: Array.isArray(to) ? to.join(', ') : to,
    subject,
    body: text,
    customerId,
    appointmentId,
    providerMessageId: response.data && response.data.id,
  })

  return {
    ok: true,
    provider: 'resend',
    id: response.data ? response.data.id : null,
  }
})

Parse.Cloud.define('sendBusinessSms', async (request) => {
  requireUser(request)
  const config = await requireMessagingConfig()

  const { to, body, customerId, appointmentId, kind } = request.params

  requireValue(to, 'to')
  requireValue(body, 'body')
  requireValue(kind, 'kind')

  const response = await sendSms({ to, body, config })

  await saveCommunicationLog({
    request,
    channel: 'sms',
    provider: 'twilio',
    kind,
    recipient: to,
    subject: '',
    body,
    customerId,
    appointmentId,
    providerMessageId: response.sid,
  })

  return {
    ok: true,
    provider: 'twilio',
    id: response.sid || null,
    status: response.status || null,
  }
})

Parse.Cloud.define('sendMarketingBlast', async (request) => {
  requireUser(request)
  const config = await requireMessagingConfig()

  const { to, subject, text, html, customerIds } = request.params

  requireValue(to, 'to')
  requireValue(subject, 'subject')
  requireValue(text, 'text')

  const resend = new Resend(config.resendApiKey)
  const response = await resend.emails.send({
    from: config.resendFromEmail,
    to,
    replyTo: config.resendReplyTo || undefined,
    subject,
    text,
    html,
  })

  if (response.error) {
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, response.error.message)
  }

  await saveCommunicationLog({
    request,
    channel: 'email',
    provider: 'resend',
    kind: 'marketing',
    recipient: Array.isArray(to) ? to.join(', ') : String(to),
    subject,
    body: text,
    customerId: Array.isArray(customerIds) ? customerIds.join(',') : '',
    appointmentId: '',
    providerMessageId: response.data && response.data.id,
  })

  return {
    ok: true,
    provider: 'resend',
    id: response.data ? response.data.id : null,
  }
})
