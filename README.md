# Pitch Ledger

A GitHub Pages-hostable PWA for a piano tuning business, backed by Parse/Back4App for secure sign-in and per-user data access.

## Features

- Customer CRM with CRUD for name, address, email, phone, reminder preferences, and notes
- Appointment tracking with date, status, base price, tax, and notes
- Quarterly sales and tax rollups for filing
- Invoice drafting by email or SMS with a Venmo payment link
- Reminder queue based on the last completed appointment
- Follow-up queue for post-service check-ins
- Marketing blast targeting that excludes recently serviced customers
- Mobile-friendly PWA install support

## Back4App setup

Create a local `.env` file using [.env.example](./.env.example):

```bash
VITE_PARSE_APP_ID=your-back4app-app-id
VITE_PARSE_JAVASCRIPT_KEY=your-back4app-javascript-key
VITE_PARSE_SERVER_URL=https://parseapi.back4app.com/
```

Recommended Parse classes:

- `Customer`
- `Appointment`
- `Business_Settings`
- `CommunicationLog`

Each new object is saved with a private ACL for the signed-in user, plus `ownerId` and `ownerUsername` fields for filtering.

## Messaging providers

The app is now wired for:

- `Resend` for email
- `Twilio` for SMS

Client actions call Parse Cloud Functions instead of opening local `mailto:` or `sms:` links.

Cloud Code scaffold:

- [cloud/main.js](./cloud/main.js)
- [cloud/package.json](./cloud/package.json)
- [cloud/.env.example](./cloud/.env.example)

Required Cloud Code environment variables:

```bash
RESEND_API_KEY=...
RESEND_FROM_EMAIL=Pitch Ledger <hello@yourdomain.com>
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_API_KEY_SID=...
TWILIO_API_KEY_SECRET=...
TWILIO_FROM_NUMBER=+18885551212
```

Current Cloud Functions:

- `sendBusinessEmail`
- `sendBusinessSms`
- `sendMarketingBlast`

Suggested next deployment step:

1. Add the `cloud/` files to your Back4App Cloud Code project.
2. Set the provider environment variables in Back4App.
3. Install Cloud Code dependencies there.
4. Test one invoice email and one reminder SMS.

## Local development

```bash
npm install
npm run dev
```

Bootstrap the first Parse user:

```bash
npm run bootstrap:user -- yourusername yourpassword you@example.com
```

Production build:

```bash
npm run build
```

## GitHub Pages deployment

This repo includes [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml), which builds and deploys the app to GitHub Pages.

Add these repository secrets before enabling the workflow:

- `VITE_PARSE_APP_ID`
- `VITE_PARSE_JAVASCRIPT_KEY`
- `VITE_PARSE_SERVER_URL`

The Vite config automatically uses `/customer-management/` as the base path for the default GitHub Pages repo URL, and `/` when the workflow is deploying to a custom domain.
