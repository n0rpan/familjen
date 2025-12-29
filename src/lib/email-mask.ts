/**
 * Mask an email address for privacy
 * Example: "john.doe@gmail.com" -> "j***e@g***l.com"
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) {
    return '***@***'
  }

  const [localPart, domain] = email.toLowerCase().split('@')
  const [domainName, ...tld] = domain.split('.')

  // Mask local part: show first and last char
  const maskedLocal = localPart.length <= 2
    ? '*'.repeat(localPart.length)
    : localPart[0] + '*'.repeat(Math.min(localPart.length - 2, 3)) + localPart[localPart.length - 1]

  // Mask domain name: show first and last char
  const maskedDomain = domainName.length <= 2
    ? '*'.repeat(domainName.length)
    : domainName[0] + '*'.repeat(Math.min(domainName.length - 2, 3)) + domainName[domainName.length - 1]

  return `${maskedLocal}@${maskedDomain}.${tld.join('.')}`
}
