/**
 * Generate Demo Images
 *
 * Uses AI to generate placeholder images for the demo mode:
 * - Child portraits (illustrated style, privacy-safe)
 * - Feed activity photos
 * - Meal photos
 *
 * Run: npx tsx scripts/generate-demo-images.ts
 *
 * Note: This script is optional. Demo mode works without images,
 * they just add visual polish.
 */

import fs from 'fs'
import path from 'path'

interface ImageSpec {
  name: string
  prompt: string
  category: 'children' | 'feed' | 'meals'
}

const IMAGES: ImageSpec[] = [
  // Children portraits (illustrated style, privacy-safe)
  {
    name: 'emilie',
    category: 'children',
    prompt: 'Illustrated portrait of a cheerful 8-year-old Norwegian girl with blonde braids, friendly smile, soft watercolor style, warm colors, suitable for family app avatar, no text',
  },
  {
    name: 'oliver',
    category: 'children',
    prompt: 'Illustrated portrait of a happy 5-year-old Norwegian boy with short brown hair, bright eyes, soft watercolor style, playful expression, family app avatar, no text',
  },
  {
    name: 'sofie',
    category: 'children',
    prompt: 'Illustrated portrait of a sweet 3-year-old Norwegian girl with curly light hair, gentle smile, soft watercolor style, warm tones, family app avatar, no text',
  },

  // Feed photos (activity scenes)
  {
    name: 'barnehage-tur',
    category: 'feed',
    prompt: 'Children on a nature walk in Norwegian forest, autumn leaves, kindergarten outdoor activity, warm natural lighting, no faces visible, cozy Scandinavian aesthetic, no text',
  },
  {
    name: 'barnehage-kunst',
    category: 'feed',
    prompt: 'Colorful children art and craft activity, painted handprints on paper, kindergarten art table, bright cheerful colors, Scandinavian style, no text',
  },
  {
    name: 'fotball-trening',
    category: 'feed',
    prompt: 'Youth soccer practice on Norwegian grass field, children in sports clothes, action shot from behind, evening light, community sports feel, no text',
  },

  // Meal photos
  {
    name: 'taco',
    category: 'meals',
    prompt: 'Norwegian-style taco Friday dinner, colorful toppings in bowls, corn shells, family dinner table, warm lighting, appetizing food photography, no text',
  },
  {
    name: 'fiskegrateng',
    category: 'meals',
    prompt: 'Traditional Norwegian fish gratin (fiskegrateng) in ceramic baking dish, golden brown cheese top, home-cooked comfort food style, no text',
  },
  {
    name: 'pasta-bolognese',
    category: 'meals',
    prompt: 'Homemade pasta bolognese on white plate, fresh basil garnish, rich tomato sauce, family dinner, warm inviting food photography, no text',
  },
  {
    name: 'kyllingwok',
    category: 'meals',
    prompt: 'Colorful chicken stir-fry with vegetables in wok, Norwegian home cooking style, steaming hot, appetizing presentation, no text',
  },
]

async function generateImages() {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('❌ OPENROUTER_API_KEY is required')
    process.exit(1)
  }

  const imageModel = process.env.OPENROUTER_IMAGE_MODEL || 'stabilityai/stable-diffusion-xl-base-1.0'
  console.log(`Using image model: ${imageModel}`)

  // Create directories
  for (const category of ['children', 'feed', 'meals']) {
    const dir = path.join('public', 'demo', category)
    fs.mkdirSync(dir, { recursive: true })
  }

  let successCount = 0
  let failCount = 0

  for (const spec of IMAGES) {
    const outputPath = path.join('public', 'demo', spec.category, `${spec.name}.jpg`)

    // Skip if already exists
    if (fs.existsSync(outputPath)) {
      console.log(`⏭️  Skipping ${spec.category}/${spec.name} (already exists)`)
      continue
    }

    console.log(`🎨 Generating ${spec.category}/${spec.name}...`)

    try {
      const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://familjen.eu',
          'X-Title': 'Familjen Demo Images',
        },
        body: JSON.stringify({
          model: imageModel,
          prompt: spec.prompt,
          n: 1,
          size: '512x512',
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        console.error(`❌ Failed to generate ${spec.name}: ${response.status} ${error}`)
        failCount++
        continue
      }

      const data = await response.json()
      const imageUrl = data.data?.[0]?.url

      if (!imageUrl) {
        console.error(`❌ No image URL in response for ${spec.name}`)
        failCount++
        continue
      }

      // Download and save the image
      const imageResponse = await fetch(imageUrl)
      if (!imageResponse.ok) {
        console.error(`❌ Failed to download image for ${spec.name}`)
        failCount++
        continue
      }

      const buffer = Buffer.from(await imageResponse.arrayBuffer())
      fs.writeFileSync(outputPath, buffer)

      console.log(`✅ Saved ${spec.category}/${spec.name}.jpg`)
      successCount++

      // Rate limit protection (2 seconds between requests)
      await new Promise(r => setTimeout(r, 2000))
    } catch (error) {
      console.error(`❌ Error generating ${spec.name}:`, error)
      failCount++
    }
  }

  console.log(`\n📊 Results: ${successCount} generated, ${failCount} failed, ${IMAGES.length - successCount - failCount} skipped`)

  if (failCount > 0) {
    console.log('\n💡 Tip: Run the script again to retry failed images')
  }
}

// Run
generateImages().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
