import { redirect } from 'next/navigation'

/**
 * Demo Entry Page
 *
 * Redirects to home page with ?demo=true parameter.
 * This provides a clean entry point: /demo
 */
export default function DemoPage() {
  redirect('/?demo=true')
}
