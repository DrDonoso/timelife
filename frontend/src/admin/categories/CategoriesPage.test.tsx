import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CategoryOut } from '../../api/schema.gen'
import { ADMIN_SESSION, TEST_CATEGORIES, mockSignedIn, renderWithProviders, reply, type MockHandler } from '../../utils/test-utils'
import { CategoriesPage } from './CategoriesPage'
import { sentBodies } from './testing'

function setup(handlers: Record<string, MockHandler> = {}, initial: CategoryOut[] = TEST_CATEGORIES) {
  let categories = initial.map((category) => ({ ...category }))
  const fetchMock = mockSignedIn(ADMIN_SESSION, {
    'GET /api/categories': () => categories,
    ...handlers,
  })
  const user = userEvent.setup()
  const view = renderWithProviders(<CategoriesPage />, { route: '/admin/categories' })
  return {
    ...view,
    fetchMock,
    user,
    setCategories(next: CategoryOut[]) {
      categories = next
    },
  }
}

/** Pastes instead of typing key by key (the form re-renders its previews on every change). */
async function fill(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, text: string) {
  await user.clear(input)
  await user.paste(text)
}

function rowNames() {
  return within(screen.getByRole('grid', { name: 'Categorías (arrastra para ordenar)' }))
    .getAllByRole('row')
    .map((row) => row.getAttribute('aria-label'))
}

describe('CategoriesPage', () => {
  it('lists the categories in order with their three names, colour and icon', async () => {
    setup()
    const row = await screen.findByRole('row', { name: 'Lenguaje y comunicación' })
    expect(within(row).getByText('Language & communication')).toBeInTheDocument()
    expect(within(row).getByText('Linguagem e comunicação').closest('[lang]')).toHaveAttribute('lang', 'pt')
    expect(within(row).getByText('#f59e0b')).toBeInTheDocument()
    expect(within(row).getByText('message-circle')).toBeInTheDocument()
    expect(rowNames()).toEqual(['Lenguaje y comunicación', 'Sueño', 'Alimentación'])
    expect(screen.getByRole('heading', { name: '3 categorías' })).toBeInTheDocument()
  })

  it('names the rows in Portuguese when the app is in Portuguese', async () => {
    localStorage.setItem('timelife.lang', 'pt')
    setup()
    expect(await screen.findByRole('row', { name: 'Sono' })).toBeInTheDocument()
    expect(screen.getAllByRole('row').map((row) => row.getAttribute('aria-label'))).toEqual([
      'Linguagem e comunicação',
      'Sono',
      'Alimentação',
    ])
  })

  it('offers to create the first category when there are none', async () => {
    setup({}, [])
    expect(await screen.findByRole('heading', { name: 'Todavía no hay categorías' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nueva categoría' })).toBeInTheDocument()
  })

  it('creates a category after validating the form', async () => {
    const created: CategoryOut = {
      id: 9,
      key: null,
      name_es: 'Primeras palabras',
      name_en: 'First words',
      name_pt: 'Primeiras palavras',
      icon: 'star',
      color: '#123abc',
      sort_order: 3,
    }
    const { user, fetchMock, setCategories, queryClient } = setup({
      'POST /api/admin/categories': () => {
        setCategories([...TEST_CATEGORIES, created])
        return reply(201, created)
      },
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await user.click(await screen.findByRole('button', { name: 'Nueva categoría' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nueva categoría' })

    await user.click(within(dialog).getByRole('button', { name: 'Crear categoría' }))
    expect(within(dialog).getByText('Escribe el nombre en español.')).toBeInTheDocument()
    expect(within(dialog).getByText('Escribe el nombre en inglés.')).toBeInTheDocument()
    expect(within(dialog).getByText('Escribe el nombre en portugués.')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Nombre en español' })).toHaveFocus()
    expect(sentBodies(fetchMock, 'POST', '/api/admin/categories')).toHaveLength(0)

    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en español' }), '  Primeras palabras ')
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en inglés' }), 'First words')
    const hex = within(dialog).getByRole('textbox', { name: 'Color' })
    await fill(user, hex, '#123ABC')
    await user.tab()
    expect(within(dialog).queryByText('Escribe el nombre en español.')).not.toBeInTheDocument()

    // The Portuguese name is required too: submitting without it focuses its field.
    await user.click(within(dialog).getByRole('button', { name: 'Crear categoría' }))
    const namePt = within(dialog).getByRole('textbox', { name: 'Nombre en portugués' })
    expect(namePt).toHaveFocus()
    expect(namePt).toHaveAttribute('aria-invalid', 'true')
    expect(namePt.closest('[lang]')).toHaveAttribute('lang', 'pt')
    expect(within(dialog).getByText('Escribe el nombre en portugués.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST', '/api/admin/categories')).toHaveLength(0)

    await fill(user, namePt, ' Primeiras palavras')
    expect(within(dialog).queryByText('Escribe el nombre en portugués.')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Crear categoría' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sentBodies(fetchMock, 'POST', '/api/admin/categories')).toEqual([
      { name_es: 'Primeras palabras', name_en: 'First words', name_pt: 'Primeiras palavras', color: '#123abc', icon: 'star' },
    ])
    expect(await screen.findByText('Categoría «Primeras palabras» creada.')).toBeInTheDocument()
    const row = await screen.findByRole('row', { name: 'Primeras palabras' })
    expect(within(row).getByText('Primeiras palavras')).toBeInTheDocument()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['categories'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['timeline'] })
  })

  it('limits every name to 60 characters', async () => {
    const { user, fetchMock } = setup()
    await user.click(await screen.findByRole('button', { name: 'Editar Sueño' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar categoría' })
    for (const name of ['Nombre en español', 'Nombre en inglés', 'Nombre en portugués']) {
      expect(within(dialog).getByRole('textbox', { name })).toHaveAttribute('maxlength', '60')
    }
    // maxlength stops typing past the limit; a longer value that gets in anyway is still checked.
    const namePt = within(dialog).getByRole('textbox', { name: 'Nombre en portugués' })
    fireEvent.change(namePt, { target: { value: 'a'.repeat(61) } })
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    expect(within(dialog).getByText('Como máximo 60 caracteres.')).toBeInTheDocument()
    expect(namePt).toHaveFocus()
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/categories/2')).toHaveLength(0)
  })

  it('suggests a colour no category uses yet and previews it on light and dark', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Nueva categoría' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nueva categoría' })
    // #f59e0b and #8b5cf6 are taken by the test categories: the first free preset is used.
    expect(within(dialog).getByRole('textbox', { name: 'Color' })).toHaveValue('#64748B')
    const preview = within(dialog).getByRole('region', { name: 'Vista previa' })
    expect(within(preview).getByText('Modo claro')).toBeInTheDocument()
    expect(within(preview).getByText('Modo oscuro')).toBeInTheDocument()
    expect(preview.querySelector('[data-theme="dark"]')).not.toBeNull()
    // The pill preview follows the typed name.
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en español' }), 'Baño')
    expect(within(preview).getAllByText('Baño').length).toBeGreaterThan(0)
  })

  it('explains that light colours are deepened for white text', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Nueva categoría' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nueva categoría' })
    expect(within(dialog).queryByText(/usan un tono algo más intenso/)).not.toBeInTheDocument()
    const hex = within(dialog).getByRole('textbox', { name: 'Color' })
    await fill(user, hex, '#fde047')
    await user.tab()
    expect(within(dialog).getByText(/usan un tono algo más intenso/)).toBeInTheDocument()
  })

  it('shows server validation errors next to the fields', async () => {
    const { user } = setup({
      'POST /api/admin/categories': reply(422, { code: 'invalid_request', fields: { name_en: 'string_too_long' } }),
    })
    await user.click(await screen.findByRole('button', { name: 'Nueva categoría' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nueva categoría' })
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en español' }), 'Baño')
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en inglés' }), 'Bath')
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en portugués' }), 'Banho')
    await user.click(within(dialog).getByRole('button', { name: 'Crear categoría' }))
    expect(await within(dialog).findByText('Es demasiado largo.')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Nombre en inglés' })).toHaveAttribute('aria-invalid', 'true')
    // Editing the field clears the server error.
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en inglés' }), 's')
    expect(within(dialog).queryByText('Es demasiado largo.')).not.toBeInTheDocument()
  })

  it('shows a server error on the Portuguese name next to its field', async () => {
    const { user, fetchMock } = setup({
      'POST /api/admin/categories': reply(422, { code: 'invalid_request', fields: { name_pt: 'value_error' } }),
    })
    await user.click(await screen.findByRole('button', { name: 'Nueva categoría' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nueva categoría' })
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en español' }), 'Baño')
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en inglés' }), 'Bath')
    const namePt = within(dialog).getByRole('textbox', { name: 'Nombre en portugués' })
    await fill(user, namePt, 'Banho')
    await user.click(within(dialog).getByRole('button', { name: 'Crear categoría' }))
    expect(await within(dialog).findByText('El valor no es válido.')).toBeInTheDocument()
    expect(namePt).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('textbox', { name: 'Nombre en español' })).not.toHaveAttribute('aria-invalid')
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST', '/api/admin/categories')).toEqual([
      expect.objectContaining({ name_es: 'Baño', name_en: 'Bath', name_pt: 'Banho' }),
    ])
    await fill(user, namePt, 'Casa de banho')
    expect(within(dialog).queryByText('El valor no es válido.')).not.toBeInTheDocument()
    expect(namePt).not.toHaveAttribute('aria-invalid')
  })

  it('shows other errors at the top of the form and keeps it open', async () => {
    const { user } = setup({ 'POST /api/admin/categories': reply(500, { code: 'internal_error' }) })
    await user.click(await screen.findByRole('button', { name: 'Nueva categoría' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nueva categoría' })
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en español' }), 'Baño')
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en inglés' }), 'Bath')
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en portugués' }), 'Banho')
    await user.click(within(dialog).getByRole('button', { name: 'Crear categoría' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ha ocurrido un error en el servidor')
  })

  it('closes with Escape right away when nothing has changed', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Editar Sueño' }))
    await screen.findByRole('dialog', { name: 'Editar categoría' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks before discarding unsaved changes (Escape or a click outside)', async () => {
    const { user, fetchMock } = setup()
    await user.click(await screen.findByRole('button', { name: 'Nueva categoría' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nueva categoría' })
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en español' }), 'Baño')

    await user.keyboard('{Escape}')
    const confirm = await screen.findByRole('alertdialog', { name: '¿Descartar los cambios?' })
    await user.click(within(confirm).getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(within(dialog).getByRole('textbox', { name: 'Nombre en español' })).toHaveValue('Baño')

    await user.click(dialog.closest('.overlay') as HTMLElement)
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar cambios' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sentBodies(fetchMock, 'POST', '/api/admin/categories')).toHaveLength(0)
  })

  it('edits a category with PUT, prefilled with its values', async () => {
    const { user, fetchMock } = setup({
      'PUT /api/admin/categories/2': ({ body }: { body: Record<string, string> }) => ({ ...TEST_CATEGORIES[1], ...body }),
    })
    await user.click(await screen.findByRole('button', { name: 'Editar Sueño' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar categoría' })
    const nameEs = within(dialog).getByRole('textbox', { name: 'Nombre en español' })
    const namePt = within(dialog).getByRole('textbox', { name: 'Nombre en portugués' })
    expect(nameEs).toHaveValue('Sueño')
    expect(within(dialog).getByRole('textbox', { name: 'Nombre en inglés' })).toHaveValue('Sleep')
    expect(namePt).toHaveValue('Sono')
    expect(within(dialog).getByRole('textbox', { name: 'Color' })).toHaveValue('#8B5CF6')
    await fill(user, nameEs, 'Siestas')
    await fill(user, namePt, 'Sestas ')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sentBodies(fetchMock, 'PUT', '/api/admin/categories/2')).toEqual([
      { name_es: 'Siestas', name_en: 'Sleep', name_pt: 'Sestas', color: '#8b5cf6', icon: 'moon' },
    ])
    expect(await screen.findByText('Categoría «Siestas» guardada.')).toBeInTheDocument()
  })

  it('counts a changed Portuguese name as an unsaved change', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Editar Sueño' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar categoría' })
    await fill(user, within(dialog).getByRole('textbox', { name: 'Nombre en portugués' }), 'Sestas')
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('alertdialog', { name: '¿Descartar los cambios?' })).toBeInTheDocument()
  })

  it('opens the editor from the row itself', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('row', { name: 'Alimentación' }))
    expect(await screen.findByRole('dialog', { name: 'Editar categoría' })).toBeInTheDocument()
  })

  it('explains how many milestones use a category that cannot be deleted', async () => {
    const { user, fetchMock } = setup({
      'DELETE /api/admin/categories/2': reply(409, { code: 'category_in_use', detail: { events: 3 } }),
    })
    await user.click(await screen.findByRole('button', { name: 'Eliminar Sueño' }))
    const dialog = await screen.findByRole('alertdialog', { name: '¿Eliminar «Sueño»?' })
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar categoría' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No se puede eliminar porque 3 hitos usan esta categoría (la papelera también cuenta).',
    )
    expect(sentBodies(fetchMock, 'DELETE', '/api/admin/categories/2')).toHaveLength(1)
    // The list (hidden behind the modal dialog) still shows it.
    expect(screen.getByRole('row', { name: 'Sueño', hidden: true })).toBeInTheDocument()
  })

  it('deletes an unused category', async () => {
    const { user, setCategories } = setup({
      'DELETE /api/admin/categories/3': () => {
        setCategories(TEST_CATEGORIES.slice(0, 2))
        return reply(204)
      },
    })
    await user.click(await screen.findByRole('button', { name: 'Eliminar Alimentación' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar categoría' }))
    await waitFor(() => expect(screen.queryByRole('row', { name: 'Alimentación' })).not.toBeInTheDocument())
    expect(screen.getByText('Categoría «Alimentación» eliminada.')).toBeInTheDocument()
  })

  it('reorders with the keyboard and saves the new order', async () => {
    const { user, fetchMock, setCategories } = setup({
      'PUT /api/admin/categories/order': ({ body }: { body: { ids: number[] } }) => {
        const next = body.ids.map((id, index) => ({ ...TEST_CATEGORIES.find((item) => item.id === id)!, sort_order: index }))
        setCategories(next)
        return next
      },
    })
    const moveDown = await screen.findByRole('button', { name: 'Bajar Lenguaje y comunicación' })
    expect(screen.getByRole('button', { name: 'Subir Lenguaje y comunicación' })).toBeDisabled()
    act(() => moveDown.focus())
    await user.keyboard('{Enter}')
    expect(rowNames()).toEqual(['Sueño', 'Lenguaje y comunicación', 'Alimentación'])
    // Focus stays on the moved item's button.
    expect(screen.getByRole('button', { name: 'Bajar Lenguaje y comunicación' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(rowNames()).toEqual(['Sueño', 'Alimentación', 'Lenguaje y comunicación'])
    // At the end "move down" is disabled, so focus moves to "move up".
    expect(screen.getByRole('button', { name: 'Subir Lenguaje y comunicación' })).toHaveFocus()
    expect(screen.getByText('Lenguaje y comunicación: posición 3 de 3.')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('Orden guardado')).toBeInTheDocument())
    const orders = sentBodies(fetchMock, 'PUT', '/api/admin/categories/order')
    expect(orders.at(-1)).toEqual({ ids: [2, 3, 1] })
    expect(rowNames()).toEqual(['Sueño', 'Alimentación', 'Lenguaje y comunicación'])
  })

  it('restores the saved order and explains when reordering fails', async () => {
    const { user } = setup({
      'PUT /api/admin/categories/order': reply(422, { code: 'invalid_order' }),
    })
    await user.click(await screen.findByRole('button', { name: 'Subir Alimentación' }))
    expect(await screen.findByText(/El orden ha cambiado mientras editabas/)).toBeInTheDocument()
    await waitFor(() => expect(rowNames()).toEqual(['Lenguaje y comunicación', 'Sueño', 'Alimentación']))
  })

  it('shows a retry state when the categories cannot be loaded', async () => {
    setup({ 'GET /api/categories': reply(500, { code: 'internal_error' }) })
    expect(await screen.findByRole('heading', { name: 'No se han podido cargar las categorías.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
