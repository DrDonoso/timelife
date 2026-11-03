import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TEST_CATEGORIES, mockSignedIn, renderWithProviders } from '../utils/test-utils'
import { ChipMultiSelect } from './ChipMultiSelect'

const OPTIONS = TEST_CATEGORIES.map((category) => ({
  id: category.id,
  label: category.name_es,
  color: category.color,
  icon: category.icon,
}))

function Harness({ ordered, initial = [], onChange }: { ordered?: boolean; initial?: number[]; onChange?: (value: number[]) => void }) {
  const [value, setValue] = useState<number[]>(initial)
  return (
    <ChipMultiSelect
      label="Categorías"
      ordered={ordered}
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
    />
  )
}

function selectedOrder() {
  const list = screen.getByRole('list', { name: 'Seleccionados' })
  return within(list)
    .queryAllByRole('listitem')
    .map((item) => item.textContent?.replace(/^\d+/, '').replace('Principal', '').trim())
}

describe('ChipMultiSelect (ordered)', () => {
  it('keeps the selection order (first = primary)', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<Harness ordered onChange={onChange} />)
    expect(await screen.findByRole('group', { name: 'Categorías' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Añadir Sueño' }))
    await user.click(screen.getByRole('button', { name: 'Añadir Lenguaje y comunicación' }))
    expect(onChange).toHaveBeenNthCalledWith(1, [2])
    expect(onChange).toHaveBeenNthCalledWith(2, [2, 1])
    expect(selectedOrder()).toEqual(['Sueño', 'Lenguaje y comunicación'])
    expect(screen.getByText('Principal')).toBeInTheDocument()
    // Selected options leave the "available" list.
    expect(screen.queryByRole('button', { name: 'Añadir Sueño' })).not.toBeInTheDocument()
  })

  it('reorders and removes items', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<Harness ordered initial={[2, 1, 3]} onChange={onChange} />)

    expect(await screen.findByRole('button', { name: 'Mover Sueño antes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover Alimentación después' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Mover Lenguaje y comunicación antes' }))
    expect(onChange).toHaveBeenLastCalledWith([1, 2, 3])
    expect(selectedOrder()).toEqual(['Lenguaje y comunicación', 'Sueño', 'Alimentación'])
    // Focus follows the moved item (its "earlier" button is now disabled, so "later" gets it).
    expect(screen.getByRole('button', { name: 'Mover Lenguaje y comunicación después' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Mover Sueño después' }))
    expect(onChange).toHaveBeenLastCalledWith([1, 3, 2])

    await user.click(screen.getByRole('button', { name: 'Quitar Lenguaje y comunicación' }))
    expect(onChange).toHaveBeenLastCalledWith([3, 2])
    expect(selectedOrder()).toEqual(['Alimentación', 'Sueño'])
    expect(screen.getByRole('button', { name: 'Añadir Lenguaje y comunicación' })).toHaveFocus()
  })
})

describe('ChipMultiSelect (unordered)', () => {
  it('toggles options in place', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)
    const sleep = await screen.findByRole('button', { name: 'Sueño' })
    expect(sleep).toHaveAttribute('aria-pressed', 'false')
    await user.click(sleep)
    expect(onChange).toHaveBeenLastCalledWith([2])
    expect(sleep).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Alimentación' }))
    expect(onChange).toHaveBeenLastCalledWith([2, 3])
    await user.click(sleep)
    expect(onChange).toHaveBeenLastCalledWith([3])
  })
})
