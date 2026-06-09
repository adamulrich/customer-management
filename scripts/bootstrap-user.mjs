import Parse from 'parse/node.js'

function printUsage() {
  console.log('Usage: npm run bootstrap:user -- <username> <password> [email]')
  console.log('Example: npm run bootstrap:user -- tuneradmin StrongPass123 admin@example.com')
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

const [username, password, email] = args
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

async function main() {
  const user = new Parse.User()
  user.set('username', username)
  user.set('password', password)

  if (email) {
    user.set('email', email)
  }

  await user.signUp()

  console.log(`Created Parse user "${username}" successfully.`)
  console.log(`objectId: ${user.id}`)
}

main().catch((error) => {
  const message = error?.message || String(error)
  console.error(`Failed to create user: ${message}`)

  if (error?.code === 202) {
    console.error('That username already exists.')
  }

  process.exit(1)
})
