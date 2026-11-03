import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockSignedIn, renderWithProviders } from '../utils/test-utils'
import type { ZoomLevel } from './types'
import { ZoomControls } from './ZoomControls'

function renderControls(level: ZoomLevel) {
  mockSignedIn()
  const handlers = { onLevelChange: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn() }
  renderWithProviders(<ZoomControls level={level} {...handlers} />)
  return handlers
}

describe('ZoomControls', () => {
  it('groups − · Años / Meses / Días · + and marks the current level', async () => {
    renderControls('months')
    const group = await screen.findByRole('group', { name: 'Zoom de la línea de tiempo' })
    expect(group).toHaveAccessibleDescription('Ctrl + rueda o pellizca para cambiar el zoom')
    expect(screen.getByRole('radio', { name: 'Meses' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Años' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Alejar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Acercar' })).toBeEnabled()
  })

  it('zooms in and out one level', async () => {
    const handlers = renderControls('months')
    fireEvent.click(await screen.findByRole('button', { name: 'Acercar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Alejar' }))
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1)
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1)
  })

  it('jumps straight to a level', async () => {
    const handlers = renderControls('years')
    fireEvent.click(await screen.findByRole('radio', { name: 'Días' }))
    expect(handlers.onLevelChange).toHaveBeenCalledWith('events')
  })

  it('disables the buttons at both ends', async () => {
    renderControls('years')
    expect(await screen.findByRole('button', { name: 'Alejar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Acercar' })).toBeEnabled()
  })

  it('cannot zoom in past the days level', async () => {
    renderControls('events')
    expect(await screen.findByRole('button', { name: 'Acercar' })).toBeDisabled()
  })

  it('can keep space free at the right edge (open filter panel)', async () => {
    mockSignedIn()
    renderWithProviders(<ZoomControls level="events" inset={384} onLevelChange={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} />)
    const group = await screen.findByRole('group', { name: 'Zoom de la línea de tiempo' })
    expect(group.style.getPropertyValue('--controls-inset')).toBe('384px')
  })
})
