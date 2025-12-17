// Generate PNG icons from SVG at various sizes
// Run with: npx tsx scripts/generate-pngs.ts

import sharp from 'sharp'
import * as fs from 'fs'
import * as path from 'path'

const ICON_SIZES = [
  16,    // favicon
  32,    // favicon
  48,    // Windows
  72,    // Android
  96,    // Android
  128,   // Chrome Web Store
  144,   // Windows tile
  152,   // iOS
  180,   // Apple touch icon
  192,   // Android/PWA
  384,   // PWA
  512,   // PWA
]

async function generatePngs() {
  const svgPath = path.join(__dirname, '../public/icons/icon.svg')
  const outputDir = path.join(__dirname, '../public/icons')

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const svgBuffer = fs.readFileSync(svgPath)

  console.log('Generating PNG icons...')

  for (const size of ICON_SIZES) {
    const outputPath = path.join(outputDir, `icon-${size}x${size}.png`)

    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath)

    console.log(`  ✓ ${size}x${size}`)
  }

  // Also create favicon.ico (use 32x32)
  const favicon32 = path.join(outputDir, 'icon-32x32.png')
  const faviconDest = path.join(__dirname, '../public/favicon.ico')

  // Copy 32x32 as favicon (browsers handle PNG favicons fine now)
  fs.copyFileSync(favicon32, path.join(outputDir, 'favicon.png'))
  console.log('  ✓ favicon.png')

  // Create apple-touch-icon (180x180)
  fs.copyFileSync(
    path.join(outputDir, 'icon-180x180.png'),
    path.join(__dirname, '../public/apple-touch-icon.png')
  )
  console.log('  ✓ apple-touch-icon.png')

  console.log('\nDone! Icons saved to public/icons/')
}

generatePngs().catch(console.error)
