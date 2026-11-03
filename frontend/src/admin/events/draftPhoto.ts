import type { CSSProperties } from 'react'
import type { ImageCrop, ImageOut } from '../../api/schema.gen'
import { framedImageStyle, sameCrop } from '../../utils/crop'

export interface DraftPhoto {
  src: string
  /** Positions the whole picture to show an unsaved framing (inside an `overflow: hidden` square). */
  style?: CSSProperties
}

/**
 * What the thumbnail of an editor image shows: its saved thumbnail while the framing is
 * unchanged, else the whole picture positioned to the new framing; the local preview while
 * uploading.
 */
export function draftPhoto(image: ImageOut | null, previewUrl: string | null, crop: ImageCrop | null): DraftPhoto | null {
  if (image && !sameCrop(crop, image.crop, image)) return { src: image.display_url, style: framedImageStyle(crop, image) }
  const src = image?.thumb_url ?? previewUrl
  return src ? { src } : null
}
