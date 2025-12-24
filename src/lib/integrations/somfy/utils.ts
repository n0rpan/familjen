/**
 * Somfy Integration Utilities
 */

interface AccountForDisplay {
  display_name: string | null
  account_email: string | null
}

/**
 * Get the display name for a Somfy account.
 * Prefers custom display_name if different from email, otherwise falls back to email.
 */
export function getAccountDisplayName(account: AccountForDisplay | undefined | null): string {
  if (!account) return ''
  // Prefer display_name if it's different from email (means user set a custom name)
  if (account.display_name && account.display_name !== account.account_email) {
    return account.display_name
  }
  return account.account_email || account.display_name || ''
}
