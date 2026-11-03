import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppearanceOut } from '../../api/schema.gen'
import { getThemeColors } from '../../theme/useThemeColors'
import { ADMIN_SESSION, mockSignedIn, renderWithProviders, reply, type MockHandler } from '../../utils/test-utils'
import { FakeXhr, imageOut, sentBodies } from '../categories/testing'
import { AppearancePage } from './AppearancePage'

const APPEARANCE: AppearanceOut = {
  year_colors: [{ year: 2025, color: '#e0567a' }],
  event_years: [2026, 2025, 2024],
  background: null,
  background_opacity: 0.18,
  default_zoom: 'events',
  direction_desktop: 'right_to_left',
  direction_mobile: 'bottom_to_top',
}

/** What the fake API answers for `GET /api/appearance` (its mutation handlers change it). */
interface FakeAppearance {
  current: AppearanceOut
}

type Handlers = Record<string, MockHandler>

function setup(handlers: Handlers | ((store: FakeAppearance) => Handlers) = {}, initial: AppearanceOut = APPEARANCE) {
  const store: FakeAppearance = { current: structuredClone(initial) }
  const fetchMock = mockSignedIn(ADMIN_SESSION, {
    'GET /api/appearance': () => store.current,
    ...(typeof handlers === 'function' ? handlers(store) : handlers),
  })
  const user = userEvent.setup()
  const view = renderWithProviders(<AppearancePage />, { route: '/admin/appearance' })
  return {
    ...view,
    fetchMock,
    user,
    setAppearance(next: AppearanceOut) {
      store.current = next
    },
  }
}

/** `PUT /api/admin/year-colors/{year}` of the fake API. */
function putYearColor(store: FakeAppearance, year: number) {
  return ({ body }: { body: { color: string } }) => {
    const others = store.current.year_colors.filter((item) => item.year !== year)
    store.current = { ...store.current, year_colors: [...others, { year, color: body.color }] }
    return store.current
  }
}

/** `DELETE /api/admin/year-colors/{year}` of the fake API. */
function deleteYearColor(store: FakeAppearance, year: number) {
  return () => {
    store.current = { ...store.current, year_colors: store.current.year_colors.filter((item) => item.year !== year) }
    return store.current
  }
}

function yearsSection() {
  return screen.getByRole('region', { name: 'Colores de los años' })
}

function yearCard(year: number) {
  return within(yearsSection()).getByRole('article', { name: String(year) })
}

/** Years with a card, top to bottom. */
function listedYears() {
  return within(yearsSection())
    .queryAllByRole('article')
    .map((card) => card.getAttribute('data-year-card'))
}

function yearPicker() {
  return screen.getByRole('combobox', { name: 'Añadir año' })
}

/** The suggestions of «Añadir año», opened with its button. */
async function openSuggestions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Mostrar sugerencias/ }))
  return within(await screen.findByRole('listbox', { name: /^Años con hitos/ })).getAllByRole('option')
}

function dotColor(option: HTMLElement) {
  return option.querySelector<HTMLElement>('[style]')?.style.getPropertyValue('--dot')
}

async function setHex(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input)
  await user.type(input, value)
  await user.tab()
}

/** Requests other than GET. */
function mutations(fetchMock: ReturnType<typeof setup>['fetchMock']) {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
}

beforeEach(() => {
  FakeXhr.instances = []
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

describe('AppearancePage · year colours', () => {
  it('lists only the years with their own colour, with no button back to the automatic one', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Colores de los años' })
    expect(listedYears()).toEqual(['2025'])
    const card = yearCard(2025)
    expect(within(card).getByRole('img', { name: 'Vista previa del año 2025' })).toHaveTextContent('2025')
    expect(within(card).getByRole('img', { name: 'Tonos de los meses de 2025, de enero a diciembre' })).toHaveTextContent(
      'ENEFEBMARABRMAYJUNJULAGOSEPOCTNOVDIC',
    )
    expect(within(card).getByRole('textbox', { name: 'Color de 2025' })).toHaveValue('#E0567A')
    expect(within(card).getByRole('button', { name: 'Quitar el color de 2025' })).toBeEnabled()
    // Everything listed has its own colour: no automatic/custom tags, nothing unsaved.
    expect(within(yearsSection()).queryByText(/^(Automático|Personalizado|Sin guardar|Sin hitos)$/)).not.toBeInTheDocument()
    expect(within(yearsSection()).queryByRole('button', { name: /automático/i })).not.toBeInTheDocument()
  })

  it('says when no year has its own colour', async () => {
    setup({}, { ...APPEARANCE, year_colors: [] })
    expect(
      await screen.findByText('Ningún año tiene color propio: todos usan su color automático. Añade un año para elegir el suyo.'),
    ).toBeInTheDocument()
    expect(listedYears()).toEqual([])
  })

  it('adds a year with milestones from the suggestions and saves its colour', async () => {
    const { user, fetchMock } = setup((store) => ({ 'PUT /api/admin/year-colors/2026': putYearColor(store, 2026) }))
    await screen.findByRole('heading', { name: 'Colores de los años' })
    // The years with milestones still on their automatic colour, newest first, with a dot of it.
    const options = await openSuggestions(user)
    expect(options.map((option) => option.textContent)).toEqual(['2026', '2024'])
    expect(options.map(dotColor)).toEqual(['#3b82f6', '#6366f1'])

    await user.click(options[0])
    const card = await screen.findByRole('article', { name: '2026' })
    const field = within(card).getByRole('textbox', { name: 'Color de 2026' })
    // It starts with its automatic colour, unsaved, with the focus on its colour.
    expect(field).toHaveValue('#3B82F6')
    await waitFor(() => expect(field).toHaveFocus())
    expect(within(card).getByText('Sin guardar')).toBeInTheDocument()
    expect(within(card).queryByText('Sin hitos')).not.toBeInTheDocument()
    expect(yearPicker()).toHaveValue('')
    expect(listedYears()).toEqual(['2026', '2025'])

    await setHex(user, field, '#FF0000')
    await user.click(within(card).getByRole('button', { name: 'Guardar el color de 2026' }))
    expect(await screen.findByText('Color de 2026 guardado.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/year-colors/2026')).toEqual([{ color: '#ff0000' }])
    await waitFor(() => expect(within(yearCard(2026)).queryByText('Sin guardar')).not.toBeInTheDocument())
    expect(within(yearCard(2026)).getByRole('textbox', { name: 'Color de 2026' })).toHaveValue('#FF0000')
    expect(within(yearCard(2026)).getByRole('button', { name: 'Quitar el color de 2026' })).toBeInTheDocument()
    expect((await openSuggestions(user)).map((option) => option.textContent)).toEqual(['2024'])
  })

  it('adds any year typed between 1900 and 2200, which can be saved as it is', async () => {
    const { user, fetchMock } = setup((store) => ({
      'PUT /api/admin/year-colors/2030': putYearColor(store, 2030),
      'DELETE /api/admin/year-colors/2030': deleteYearColor(store, 2030),
    }))
    await screen.findByRole('heading', { name: 'Colores de los años' })
    const input = yearPicker()
    const add = screen.getByRole('button', { name: 'Añadir' })

    await user.type(input, '1899')
    await user.click(add)
    expect(screen.getByText('Escribe un año entre 1900 y 2200.')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')

    await user.clear(input)
    expect(screen.queryByText('Escribe un año entre 1900 y 2200.')).not.toBeInTheDocument()
    await user.type(input, '2025')
    await user.click(add)
    expect(screen.getByText('2025 ya tiene su propio color.')).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, '20x305')
    expect(input).toHaveValue('2030')
    await user.keyboard('{Enter}')
    const card = await screen.findByRole('article', { name: '2030' })
    expect(within(card).getByText('Sin hitos')).toBeInTheDocument()
    expect(within(card).getByText('Sin guardar')).toBeInTheDocument()
    const field = within(card).getByRole('textbox', { name: 'Color de 2030' })
    expect(field).toHaveValue('#F97316')
    await waitFor(() => expect(field).toHaveFocus())
    expect(input).toHaveValue('')
    expect(listedYears()).toEqual(['2030', '2025'])

    await user.type(input, '2030')
    await user.click(add)
    expect(screen.getByText('2030 ya está en la lista.')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Guardar el color de 2030' }))
    expect(await screen.findByText('Color de 2030 guardado.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/year-colors/2030')).toEqual([{ color: '#f97316' }])
    await waitFor(() => expect(within(yearCard(2030)).queryByText('Sin guardar')).not.toBeInTheDocument())
    expect(within(yearCard(2030)).getByRole('button', { name: 'Quitar el color de 2030' })).toBeInTheDocument()

    // Its colour removed, it leaves the list (it does not come back as an unsaved year).
    await user.click(within(yearCard(2030)).getByRole('button', { name: 'Quitar el color de 2030' }))
    expect(await screen.findByText('2030 vuelve a su color automático.')).toBeInTheDocument()
    await waitFor(() => expect(listedYears()).toEqual(['2025']))
  })

  it('discards a year that is not saved yet', async () => {
    const { user, fetchMock } = setup()
    await screen.findByRole('heading', { name: 'Colores de los años' })
    await user.type(yearPicker(), '1999{Enter}')
    const card = await screen.findByRole('article', { name: '1999' })
    await setHex(user, within(card).getByRole('textbox', { name: 'Color de 1999' }), '#123456')
    await user.click(within(card).getByRole('button', { name: 'Descartar 1999' }))
    expect(listedYears()).toEqual(['2025'])
    await waitFor(() => expect(yearPicker()).toHaveFocus())
    expect(mutations(fetchMock)).toEqual([])

    // Added again, it starts over from its automatic colour.
    await user.type(yearPicker(), '1999{Enter}')
    expect(within(await screen.findByRole('article', { name: '1999' })).getByRole('textbox', { name: 'Color de 1999' })).toHaveValue(
      '#8B5CF6',
    )
  })

  it('removes the colour of a year, which goes back to its automatic one', async () => {
    const { user, fetchMock } = setup((store) => ({ 'DELETE /api/admin/year-colors/2025': deleteYearColor(store, 2025) }))
    await screen.findByRole('heading', { name: 'Colores de los años' })
    await user.click(within(yearCard(2025)).getByRole('button', { name: 'Quitar el color de 2025' }))
    expect(await screen.findByText('2025 vuelve a su color automático.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'DELETE', '/api/admin/year-colors/2025')).toHaveLength(1)
    await waitFor(() => expect(listedYears()).toEqual([]))
    expect(screen.getByText(/^Ningún año tiene color propio/)).toBeInTheDocument()
    expect(yearPicker()).toHaveFocus()
    expect((await openSuggestions(user)).map((option) => option.textContent)).toEqual(['2026', '2025', '2024'])
  })

  it('undoes an unsaved colour', async () => {
    const { user, fetchMock } = setup()
    await screen.findByRole('heading', { name: 'Colores de los años' })
    const card = yearCard(2025)
    const input = within(card).getByRole('textbox', { name: 'Color de 2025' })
    await setHex(user, input, '#00ff00')
    expect(within(card).getByText('Sin guardar')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Deshacer' }))
    expect(input).toHaveValue('#E0567A')
    expect(within(card).queryByText('Sin guardar')).not.toBeInTheDocument()
    await waitFor(() => expect(input).toHaveFocus())
    expect(mutations(fetchMock)).toEqual([])
  })

  it('reports year colour errors', async () => {
    const { user } = setup({ 'PUT /api/admin/year-colors/2025': reply(422, { code: 'invalid_year' }) })
    await screen.findByRole('heading', { name: 'Colores de los años' })
    const card = yearCard(2025)
    await setHex(user, within(card).getByRole('textbox', { name: 'Color de 2025' }), '#abcdef')
    await user.click(within(card).getByRole('button', { name: 'Guardar el color de 2025' }))
    expect(await screen.findByText('El año no es válido.')).toBeInTheDocument()
    expect(within(card).getByText('Sin guardar')).toBeInTheDocument()
  })

  it('suggests and starts new years with the automatic colours of the chosen theme', async () => {
    localStorage.setItem('timelife.palette', 'ocean')
    const ocean = getThemeColors('ocean', 'light')
    const { user } = setup()
    await screen.findByRole('heading', { name: 'Colores de los años' })
    const options = await openSuggestions(user)
    expect(options.map(dotColor)).toEqual([ocean.autoYear(2026), ocean.autoYear(2024)])
    expect(ocean.autoYear(2026)).not.toBe('#3b82f6')
    await user.click(options[1])
    const card = await screen.findByRole('article', { name: '2024' })
    expect(within(card).getByRole('textbox', { name: 'Color de 2024' })).toHaveValue(ocean.autoYear(2024).toUpperCase())
  })

  it('picks a suggestion with the keyboard', async () => {
    const { user } = setup()
    await screen.findByRole('heading', { name: 'Colores de los años' })
    await user.type(yearPicker(), '202')
    const listbox = await screen.findByRole('listbox', { name: /^Años con hitos/ })
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['2026', '2024'])
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    const card = await screen.findByRole('article', { name: '2024' })
    await waitFor(() => expect(within(card).getByRole('textbox', { name: 'Color de 2024' })).toHaveFocus())
    expect(yearPicker()).toHaveValue('')
    expect(listedYears()).toEqual(['2025', '2024'])
  })
})
describe('AppearancePage · timeline settings', () => {
  it('saves the default zoom', async () => {
    const { user, fetchMock, setAppearance } = setup({
      'PUT /api/admin/settings': ({ body }: { body: Partial<AppearanceOut> }) => {
        const next = { ...APPEARANCE, default_zoom: body.default_zoom ?? 'events' }
        setAppearance(next)
        return next
      },
    })
    const save = await screen.findByRole('button', { name: 'Guardar cambios' })
    expect(save).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Años' }))
    expect(screen.getByText('Tienes cambios sin guardar.')).toBeInTheDocument()
    expect(screen.getByText(/Se abre con un círculo por año/)).toBeInTheDocument()
    await user.click(save)
    expect(await screen.findByText('Apariencia guardada.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/settings')).toEqual([
      {
        background_image_id: null,
        background_opacity: 0.18,
        default_zoom: 'years',
        direction_desktop: 'right_to_left',
        direction_mobile: 'bottom_to_top',
      },
    ])
    await waitFor(() => expect(screen.queryByText('Tienes cambios sin guardar.')).not.toBeInTheDocument())
    expect(screen.getByRole('radio', { name: 'Años' })).toBeChecked()
  })

  it('chooses the direction of the timeline separately for computers and phones', async () => {
    const { user, fetchMock, setAppearance } = setup({
      'PUT /api/admin/settings': ({ body }: { body: Partial<AppearanceOut> }) => {
        const next = { ...APPEARANCE, ...body } as AppearanceOut
        setAppearance(next)
        return next
      },
    })
    const desktop = await screen.findByRole('radiogroup', { name: 'Dirección en ordenador y tableta' })
    const mobile = screen.getByRole('radiogroup', { name: 'Dirección en el móvil' })
    // Today's layout: newest on the left on computers, at the top on phones.
    expect(within(desktop).getByRole('radio', { name: 'De derecha a izquierda' })).toBeChecked()
    expect(within(mobile).getByRole('radio', { name: 'De abajo arriba' })).toBeChecked()
    expect(screen.getByText('De derecha a izquierda: lo más reciente queda a la izquierda.')).toBeInTheDocument()
    expect(screen.getByText('De abajo arriba: lo más reciente queda arriba.')).toBeInTheDocument()

    await user.click(within(desktop).getByRole('radio', { name: 'De izquierda a derecha' }))
    await user.click(within(mobile).getByRole('radio', { name: 'De arriba abajo' }))
    expect(screen.getByText('De izquierda a derecha: lo más reciente queda a la derecha.')).toBeInTheDocument()
    expect(screen.getByText('De arriba abajo: lo más reciente queda abajo.')).toBeInTheDocument()
    expect(screen.getByText('Tienes cambios sin guardar.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Apariencia guardada.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/settings')).toEqual([
      {
        background_image_id: null,
        background_opacity: 0.18,
        default_zoom: 'events',
        direction_desktop: 'left_to_right',
        direction_mobile: 'top_to_bottom',
      },
    ])
    await waitFor(() => expect(screen.queryByText('Tienes cambios sin guardar.')).not.toBeInTheDocument())
    expect(within(desktop).getByRole('radio', { name: 'De izquierda a derecha' })).toBeChecked()
  })

  it('discards unsaved settings', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('radio', { name: 'Meses' }))
    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.getByRole('radio', { name: 'Días' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('uploads a background, adjusts its opacity and saves both', async () => {
    const image = imageOut('33333333-3333-4333-8333-333333333333', 'campo')
    const { user, fetchMock } = setup({
      'PUT /api/admin/settings': ({ body }: { body: { background_opacity: number } }) => ({
        ...APPEARANCE,
        background: image,
        background_opacity: body.background_opacity,
      }),
    })
    await screen.findByRole('heading', { name: 'Fondo' })
    expect(screen.getByRole('img', { name: 'Vista previa: fondo predeterminado' })).toBeInTheDocument()
    const slider = screen.getByRole('slider', { name: 'Opacidad de la imagen' })
    expect(slider).toBeDisabled()

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('file input not found')
    await user.upload(input, new File(['jpg'], 'campo.jpg', { type: 'image/jpeg' }))
    const xhr = FakeXhr.last
    expect(xhr.url).toBe('/api/admin/uploads?purpose=background')
    act(() => xhr.progress(70, 100))
    expect(screen.getByRole('progressbar', { name: 'Subiendo campo.jpg…' })).toHaveAttribute('aria-valuenow', '70')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    act(() => xhr.respond(201, image))

    const preview = await screen.findByRole('img', { name: 'Vista previa: imagen de fondo al 18 %' })
    await waitFor(() => expect(preview.querySelector('[style*="background-image"]')?.getAttribute('style')).toContain(image.display_url))
    expect(slider).toBeEnabled()
    act(() => slider.focus())
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect((slider as HTMLInputElement).value).toBe('0.2')
    expect(screen.getByText(/^20\s%$/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Apariencia guardada.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/settings')).toEqual([
      {
        background_image_id: image.id,
        background_opacity: 0.2,
        default_zoom: 'events',
        direction_desktop: 'right_to_left',
        direction_mobile: 'bottom_to_top',
      },
    ])
  })

  it('removes the background image', async () => {
    const image = imageOut('44444444-4444-4444-8444-444444444444', 'playa')
    const { user, fetchMock } = setup(
      { 'PUT /api/admin/settings': () => ({ ...APPEARANCE, background: null }) },
      { ...APPEARANCE, background: image, background_opacity: 0.3 },
    )
    await user.click(await screen.findByRole('button', { name: 'Quitar imagen' }))
    expect(screen.getByRole('img', { name: 'Vista previa: fondo predeterminado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subir imagen' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(sentBodies(fetchMock, 'PUT', '/api/admin/settings')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/settings')[0]).toEqual({
      background_image_id: null,
      background_opacity: 0.3,
      default_zoom: 'events',
      direction_desktop: 'right_to_left',
      direction_mobile: 'bottom_to_top',
    })
  })

  it('shows why the settings could not be saved', async () => {
    const { user } = setup({ 'PUT /api/admin/settings': reply(422, { code: 'invalid_image' }) })
    await user.click(await screen.findByRole('radio', { name: 'Meses' }))
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Alguna imagen ya no está disponible. Vuelve a subirla.')
    expect(screen.getByText('Tienes cambios sin guardar.')).toBeInTheDocument()
  })

  it('shows a retry state when the appearance cannot be loaded', async () => {
    setup({ 'GET /api/appearance': reply(500, { code: 'internal_error' }) })
    expect(await screen.findByRole('heading', { name: 'No se ha podido cargar la apariencia.' })).toBeInTheDocument()
  })
})
