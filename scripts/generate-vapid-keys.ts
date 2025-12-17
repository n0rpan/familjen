// Generate VAPID keys for web push notifications
// Run once: npx tsx scripts/generate-vapid-keys.ts
// Then add the output to your .env.local and Vercel env vars

import webPush from 'web-push'

const vapidKeys = webPush.generateVAPIDKeys()

console.log('Add these to your environment variables:\n')
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`)
console.log('\nAlso set:')
console.log('VAPID_SUBJECT=mailto:your-email@example.com')
