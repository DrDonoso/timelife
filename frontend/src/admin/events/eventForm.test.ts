import { describe, expect, it } from 'vitest'
import type { ImageOut } from '../../api/schema.gen'
import { translate, type TranslationKey, type TranslationParams } from '../../i18n'
import {
  buildEventIn,
  buildEventUpdateIn,
  canRetryUpload,
  draftCrop,
  draftFromImage,
  draftUploaded,
  effectiveCoverKey,
  fileStem,
  formSnapshot,
  initialFormValues,
  insertImages,
  isLiveDraft,
  isSupportedImageFile,
  mediaKindOf,
  moveImages,
  pairLivePhotos,
  parseId,
  validateEventForm,
  type DraftImage,
  type EventFormValues,
} from './eventForm'

const t = (key: TranslationKey, params?: TranslationParams) => translate('es', key, params)

function image(id: string, name = id): ImageOut {
  return {
    id,
    name,
    kind: 'image',
    width: 10,
    height: 10,
    dominant_color: '#112233',
    crop: null,
    thumb_url: `/t/${id}`,
    display_url: `/d/${id}`,
    video_status: null,
    video_url: null,
    duration: null,
    live: false,
  }
}

const VALID: EventFormValues = {
  title: '  Primeros pasos ',
  date: '2026-03-12',
  childIds: [2, 1],
  categoryIds: [3, 1],
  location: '  ',
  notes: ' Dio tres pasos. ',
}

describe('validateEventForm', () => {
  it('accepts a complete form', () => {
    expect(validateEventForm(VALID, [], t)).toEqual({})
  })

  it('requires title, date, children and categories', () => {
    const errors = validateEventForm({ ...VALID, title: '   ', date: null, childIds: [], categoryIds: [] }, [], t)
    expect(errors).toEqual({
      title: 'Escribe un título.',
      date: 'Elige una fecha válida.',
      children: 'Elige al menos un niño.',
      categories: 'Elige al menos una categoría.',
    })
    expect(validateEventForm({ ...VALID, date: '2026-02-30' }, [], t).date).toBeDefined()
  })

  it('mirrors the backend length limits', () => {
    const errors = validateEventForm(
      { ...VALID, title: 'x'.repeat(121), location: 'x'.repeat(201), notes: 'x'.repeat(5001), categoryIds: Array.from({ length: 21 }, (_, i) => i + 1) },
      [],
      t,
    )
    expect(errors.title).toBe('Como máximo 120 caracteres.')
    expect(errors.location).toBe('Como máximo 200 caracteres.')
    expect(errors.notes).toBe('Como máximo 5000 caracteres.')
    expect(errors.categories).toBe('Como máximo 20.')
  })

  it('blocks saving while images upload or after failures', () => {
    const done = draftFromImage(image('a'))
    expect(validateEventForm(VALID, [done, { ...done, key: 'b', status: 'uploading' }], t).images).toBe(
      'Espera a que terminen de subirse las fotos y los vídeos.',
    )
    expect(validateEventForm(VALID, [done, { ...done, key: 'b', status: 'error', error: 'network' }], t).images).toBe(
      'Algunas fotos o vídeos no se han podido subir o procesar: reinténtalo o quítalos.',
    )
    expect(validateEventForm(VALID, [{ ...done, name: ' ' }], t).images).toMatch(/necesitan un nombre/)
    const many = Array.from({ length: 51 }, (_, index) => draftFromImage(image(`i${index}`)))
    expect(validateEventForm(VALID, many, t).images).toBe('Como máximo 50 fotos y vídeos.')
  })
})

describe('payloads', () => {
  const images: DraftImage[] = [
    draftFromImage(image('a', 'Uno')),
    { ...draftFromImage(image('b', ' Dos ')), name: ' Dos ' },
    draftFromImage(image('c', 'Tres')),
  ]

  it('builds EventIn with trimmed text, ordered ids, ordered images and the cover', () => {
    expect(buildEventIn(VALID, images, 'c')).toEqual({
      title: 'Primeros pasos',
      date: '2026-03-12',
      notes: 'Dio tres pasos.',
      location: null,
      child_ids: [2, 1],
      category_ids: [3, 1],
      images: [
        { id: 'a', name: 'Uno' },
        { id: 'b', name: 'Dos' },
        { id: 'c', name: 'Tres' },
      ],
      cover_image_id: 'c',
    })
  })

  it('falls back to the first image as cover, or none without images', () => {
    expect(buildEventIn(VALID, images, null).cover_image_id).toBe('a')
    expect(buildEventIn(VALID, images, 'gone').cover_image_id).toBe('a')
    expect(buildEventIn(VALID, [], 'a')).toMatchObject({ images: [], cover_image_id: null })
  })

  it('adds the version for updates', () => {
    expect(buildEventUpdateIn({ ...VALID, location: ' Casa ' }, images.slice(0, 1), null, 7)).toMatchObject({
      location: 'Casa',
      cover_image_id: 'a',
      version: 7,
    })
  })

  it('defaults a new event to today and the given children', () => {
    const values = initialFormValues(null, [2, 2])
    expect(values).toMatchObject({ title: '', childIds: [2], categoryIds: [], location: '', notes: '' })
    expect(values.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('sends the framing of the images that have one, normalized like the server', () => {
    const wide = { ...image('w', 'Ancha'), width: 1600, height: 1200 }
    const framed = { ...draftFromImage(wide), crop: draftCrop(draftFromImage(wide), { x: 0, y: 0.9, zoom: 2 }) }
    expect(framed.crop).toEqual({ x: 0.1875, y: 0.75, zoom: 2 })
    expect(buildEventIn(VALID, [images[0], framed], null).images).toEqual([
      { id: 'a', name: 'Uno' },
      { id: 'w', name: 'Ancha', crop: { x: 0.1875, y: 0.75, zoom: 2 } },
    ])
    // The centred square is no framing; images still uploading have none.
    expect(draftCrop(draftFromImage(wide), { x: 0.5, y: 0.5, zoom: 1 })).toBeNull()
    expect(draftCrop({ image: null }, { x: 0.2, y: 0.5, zoom: 2 })).toBeNull()
    // A new framing is an unsaved change.
    const before = formSnapshot(VALID, [draftFromImage(wide)], null)
    expect(formSnapshot(VALID, [framed], null)).not.toBe(before)
    expect(draftFromImage({ ...wide, crop: { x: 0.3, y: 0.5, zoom: 1.5 } }).crop).toEqual({ x: 0.3, y: 0.5, zoom: 1.5 })
  })

  it('detects changes through the snapshot (including the effective cover)', () => {
    const base = formSnapshot(VALID, images, null)
    expect(formSnapshot(VALID, images, 'a')).toBe(base)
    expect(formSnapshot(VALID, images, 'b')).not.toBe(base)
    expect(formSnapshot(VALID, [images[1], images[0], images[2]], null)).not.toBe(base)
    expect(formSnapshot({ ...VALID, title: 'Otro' }, images, null)).not.toBe(base)
  })

  it('computes the effective cover', () => {
    expect(effectiveCoverKey(images, 'b')).toBe('b')
    expect(effectiveCoverKey(images, 'zzz')).toBe('a')
    expect(effectiveCoverKey([], 'a')).toBeNull()
  })

  it('lists videos still converting and sends the Live choice of Live Photos only', () => {
    const converting = draftFromImage({ ...image('v', 'Paseo'), kind: 'video', video_status: 'processing', duration: 12 })
    const live = draftFromImage({ ...image('l', 'Risas'), video_status: 'ready', video_url: '/api/media/l/video', duration: 2, live: true })
    const off = { ...live, key: 'l2', id: 'l2', live: false }
    expect([converting.status, live.status, isLiveDraft(live), isLiveDraft(converting)]).toEqual(['processing', 'done', true, false])
    expect(buildEventIn(VALID, [converting, live, off, images[0]], null).images).toEqual([
      { id: 'v', name: 'Paseo' },
      { id: 'l', name: 'Risas', live: true },
      { id: 'l2', name: 'Risas', live: false },
      { id: 'a', name: 'Uno' },
    ])
    // Switching Live on or off is an unsaved change.
    expect(formSnapshot(VALID, [off], null)).not.toBe(formSnapshot(VALID, [{ ...off, live: true }], null))
  })

  it('reflects the server state of videos and Live Photos', () => {
    const failedVideo = draftFromImage({ ...image('v'), kind: 'video', video_status: 'failed' })
    expect([failedVideo.status, failedVideo.error]).toEqual(['error', 'video_processing_failed'])
    expect(canRetryUpload(failedVideo.error)).toBe(false)
    // A Live Photo whose clip failed is still a photo.
    const failedClip = draftFromImage({ ...image('l'), video_status: 'failed', live: false })
    expect([failedClip.status, isLiveDraft(failedClip)]).toEqual(['done', true])
    // An upload answer keeps a name the admin already changed.
    const renamed = { ...draftFromImage(image('x', 'IMG_9')), name: 'Mi foto', renamed: true }
    expect(draftUploaded(renamed, { ...image('x', 'IMG_9'), kind: 'video', video_status: 'processing', progress: 0.4 })).toMatchObject({
      status: 'processing',
      progress: 0.4,
      kind: 'video',
      name: 'Mi foto',
    })
  })
})

describe('files and ordering', () => {
  it('accepts supported images by type, or by extension when the type is unknown', () => {
    expect(isSupportedImageFile({ name: 'a.jpg', type: 'image/jpeg' })).toBe(true)
    expect(isSupportedImageFile({ name: 'a.HEIC', type: '' })).toBe(true)
    expect(isSupportedImageFile({ name: 'a.heic', type: 'application/octet-stream' })).toBe(true)
    expect(isSupportedImageFile({ name: 'photo', type: 'image/webp' })).toBe(true)
    expect(isSupportedImageFile({ name: 'doc.pdf', type: 'application/pdf' })).toBe(false)
    expect(isSupportedImageFile({ name: 'a.avif', type: 'image/avif' })).toBe(false)
    expect(isSupportedImageFile({ name: 'a.jpg', type: 'text/plain' })).toBe(false)
  })

  it('derives the image name from the file name', () => {
    expect(fileStem('IMG_0001.JPG')).toBe('IMG_0001')
    expect(fileStem('vacaciones.2026.heic')).toBe('vacaciones.2026')
    expect(fileStem('.hidden')).toBe('.hidden')
    expect(fileStem('x'.repeat(200) + '.png')).toHaveLength(160)
  })

  it('tells photos, videos and iCloud Live Photos apart (by type, or by extension when the type is unknown)', () => {
    expect(mediaKindOf({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image')
    expect(mediaKindOf({ name: 'a.HEIC', type: '' })).toBe('image')
    expect(mediaKindOf({ name: 'clip.mp4', type: 'video/mp4' })).toBe('video')
    expect(mediaKindOf({ name: 'IMG_1.MOV', type: 'video/quicktime' })).toBe('video')
    expect(mediaKindOf({ name: 'IMG_1.MOV', type: '' })).toBe('video')
    expect(mediaKindOf({ name: 'video', type: 'video/webm' })).toBe('video')
    expect(mediaKindOf({ name: 'cumple.mkv', type: 'application/octet-stream' })).toBe('video')
    expect(mediaKindOf({ name: 'IMG_1.livp', type: '' })).toBe('livp')
    expect(mediaKindOf({ name: 'IMG_1.livp', type: 'application/zip' })).toBe('livp')
    expect(mediaKindOf({ name: 'doc.pdf', type: 'application/pdf' })).toBeNull()
    expect(mediaKindOf({ name: 'a.mp4', type: 'text/plain' })).toBeNull()
    expect(mediaKindOf({ name: 'music.mp3', type: 'audio/mpeg' })).toBeNull()
  })

  it('pairs the photo and the clip of each Live Photo, at the photo’s place', () => {
    const file = (name: string) => new File(['x'], name)
    const [still, other, clip, video, jpeg, mp4, dupA, dupB, dupClip] = [
      'IMG_0001.HEIC',
      'otra.png',
      'img_0001.mov',
      'paseo.mp4',
      'IMG_E0002.JPG',
      'IMG_E0002.MP4',
      'IMG_3.heic',
      'IMG_3.jpg',
      'IMG_3.mov',
    ].map(file)
    const uploads = pairLivePhotos([still, other, clip, video, jpeg, mp4, dupA, dupB, dupClip])
    expect(uploads.map(({ file: main, motion }) => [main.name, motion?.name ?? null])).toEqual([
      ['IMG_0001.HEIC', 'img_0001.mov'],
      ['otra.png', null],
      ['paseo.mp4', null],
      ['IMG_E0002.JPG', 'IMG_E0002.MP4'],
      // Two photos share the name: nothing is paired.
      ['IMG_3.heic', null],
      ['IMG_3.jpg', null],
      ['IMG_3.mov', null],
    ])
    expect(pairLivePhotos([clip])).toEqual([{ file: clip, motion: null }])
  })

  it('moves and inserts items around a target', () => {
    const list = ['a', 'b', 'c', 'd'].map((key) => ({ key }))
    const keys = (items: Array<{ key: string }>) => items.map((item) => item.key).join('')
    expect(keys(moveImages(list, new Set(['a']), 'c', 'after'))).toBe('bcad')
    expect(keys(moveImages(list, new Set(['d']), 'a', 'before'))).toBe('dabc')
    expect(keys(moveImages(list, new Set(['b']), 'b', 'after'))).toBe('abcd')
    expect(keys(insertImages(list, [{ key: 'x' }], { key: 'b', position: 'before' }))).toBe('axbcd')
    expect(keys(insertImages(list, [{ key: 'x' }], { key: 'd', position: 'after' }))).toBe('abcdx')
    expect(keys(insertImages(list, [{ key: 'x' }]))).toBe('abcdx')
  })

  it('parses ids from the URL', () => {
    expect(parseId('42')).toBe(42)
    expect(parseId('0')).toBeNull()
    expect(parseId('4.2')).toBeNull()
    expect(parseId('abc')).toBeNull()
    expect(parseId('99999999999')).toBeNull()
    expect(parseId(null)).toBeNull()
  })
})
