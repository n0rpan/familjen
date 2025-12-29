import { createClient } from '@/lib/supabase/server'
import { SharedWishlistClient } from './SharedWishlistClient'

interface PageProps {
  params: Promise<{ token: string }>
}

interface WishlistItemData {
  id: string
  name: string
  description: string | null
  link: string | null
  price: number | null
  image_path: string | null
  occasion: string
  priority: number
  status: string
  reserved_by: string | null
  person_name: string
  person_type: string
}

export default async function SharedWishlistPage({ params }: PageProps) {
  const { token } = await params
  const supabase = await createClient()

  // Fetch wishlist using the public function
  const { data: items, error } = await supabase.rpc('get_shared_wishlist', {
    p_token: token,
  }) as { data: WishlistItemData[] | null; error: unknown }

  if (error || !items || items.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--background)' }}>
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            Wishlist not found
          </h1>
          <p style={{ color: 'var(--muted)' }}>
            This link may have expired or been removed.
          </p>
        </div>
      </div>
    )
  }

  // Get person info from first item
  const personName = items[0].person_name
  const personType = items[0].person_type

  // Get image URLs
  const itemsWithUrls = items.map(item => ({
    ...item,
    imageUrl: item.image_path
      ? supabase.storage.from('wishlist-images').getPublicUrl(item.image_path).data.publicUrl
      : null,
  }))

  // Group by occasion
  const byOccasion = itemsWithUrls.reduce((acc, item) => {
    if (!acc[item.occasion]) {
      acc[item.occasion] = []
    }
    acc[item.occasion].push(item)
    return acc
  }, {} as Record<string, typeof itemsWithUrls>)

  return (
    <SharedWishlistClient
      token={token}
      personName={personName}
      byOccasion={byOccasion}
    />
  )
}
