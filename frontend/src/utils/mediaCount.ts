import type { TranslationKey, TranslationParams } from '../i18n'

type Translate = (key: TranslationKey, params?: TranslationParams) => string

/** What an event holds: "3 fotos", "1 vídeo" or "2 fotos · 1 vídeo" (`total` counts both). */
export function mediaCount(t: Translate, total: number, videos: number): string {
  const photos = Math.max(0, total - videos)
  if (videos <= 0) return t('common.photos', { count: photos })
  if (photos === 0) return t('common.videos', { count: videos })
  return `${t('common.photos', { count: photos })} · ${t('common.videos', { count: videos })}`
}
