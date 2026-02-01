/**
 * Family API: Health Check
 *
 * GET /api/family - Health check endpoint
 *
 * Returns API status and version information.
 * No authentication required.
 */

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    api: 'Family API',
    version: '1.0',
    timestamp: new Date().toISOString(),
  })
}
