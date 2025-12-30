/**
 * Client-side image compression utility
 * Resizes large images and converts to WebP for smaller file sizes
 * Falls back to JPEG if WebP is not supported
 */

interface CompressOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  maxSizeBytes?: number
  format?: 'webp' | 'jpeg'
}

interface CompressResult {
  base64: string
  blob: Blob
  width: number
  height: number
  originalSize: number
  compressedSize: number
  format: 'webp' | 'jpeg'
}

const DEFAULT_OPTIONS: Required<CompressOptions> = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.85,
  maxSizeBytes: 2 * 1024 * 1024, // 2MB target
  format: 'webp',
}

/**
 * Check if the browser supports WebP encoding
 */
function supportsWebP(): boolean {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const dataUrl = canvas.toDataURL('image/webp')
    return dataUrl?.startsWith('data:image/webp') ?? false
  } catch {
    return false
  }
}

/**
 * Compress an image file to WebP/JPEG with size limits
 * Handles large iPhone photos (HEIC, large JPEGs) by resizing and compressing
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {}
): Promise<CompressResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Determine output format (WebP preferred, fallback to JPEG)
  const useWebP = opts.format === 'webp' && supportsWebP()
  const mimeType = useWebP ? 'image/webp' : 'image/jpeg'
  const outputFormat = useWebP ? 'webp' : 'jpeg'

  return new Promise((resolve, reject) => {
    const img = new Image()
    const originalSize = file.size

    img.onload = () => {
      try {
        // Calculate new dimensions maintaining aspect ratio
        let { width, height } = img
        const aspectRatio = width / height

        if (width > opts.maxWidth) {
          width = opts.maxWidth
          height = Math.round(width / aspectRatio)
        }
        if (height > opts.maxHeight) {
          height = opts.maxHeight
          width = Math.round(height * aspectRatio)
        }

        // Create canvas and draw resized image
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not get canvas context'))
          return
        }

        // Use high-quality image smoothing
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, width, height)

        // Try to compress to target size, reducing quality if needed
        let quality = opts.quality
        let blob: Blob | null = null

        const tryCompress = () => {
          canvas.toBlob(
            (result) => {
              if (!result) {
                reject(new Error('Failed to compress image'))
                return
              }

              // If still too large and quality can be reduced, try again
              if (result.size > opts.maxSizeBytes && quality > 0.5) {
                quality -= 0.1
                tryCompress()
                return
              }

              blob = result

              // Convert to base64 for API usage
              const reader = new FileReader()
              reader.onloadend = () => {
                resolve({
                  base64: reader.result as string,
                  blob: blob!,
                  width,
                  height,
                  originalSize,
                  compressedSize: blob!.size,
                  format: outputFormat,
                })
              }
              reader.onerror = () => reject(new Error('Failed to read compressed image'))
              reader.readAsDataURL(blob)
            },
            mimeType,
            quality
          )
        }

        tryCompress()
      } catch (err) {
        reject(err)
      }
    }

    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }

    // Load image from file
    const reader = new FileReader()
    reader.onload = (e) => {
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Compress image and return only the base64 string (for AI API calls)
 */
export async function compressImageToBase64(
  file: File,
  options: CompressOptions = {}
): Promise<string> {
  const result = await compressImage(file, options)
  return result.base64
}
