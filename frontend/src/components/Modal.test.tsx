import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { fireTouch, mockSignedIn, renderWithProviders } from '../utils/test-utils'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal, type ModalProps } from './Modal'

function ModalHarness(props: Partial<ModalProps> & { onChange?: (open: boolean) => void }) {
  const { onChange, ...rest } = props
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onPress={() => setOpen(true)}>Abrir</Button>
      <Modal
        title="Nuevo evento"
        {...rest}
        isOpen={open}
        onOpenChange={(next) => {
          onChange?.(next)
          setOpen(next)
        }}
      >
        {(close) => (
          <>
            <p>Contenido</p>
            <Button onPress={close}>Hecho</Button>
          </>
        )}
      </Modal>
    </>
  )
}

describe('Modal', () => {
  it('opens a labelled dialog and closes with the close button, restoring focus', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<ModalHarness onChange={onChange} />)
    const trigger = await screen.findByRole('button', { name: 'Abrir' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo evento' })
    expect(dialog).toHaveTextContent('Contenido')
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onChange).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('closes with Escape and through the render-prop close()', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    renderWithProviders(<ModalHarness />)
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    await user.click(await screen.findByRole('button', { name: 'Hecho' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('uses aria-label when there is no visible title and renders a footer', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    renderWithProviders(<ModalHarness title={undefined} aria-label="Detalle del hito" footer={<span>Pie</span>} />)
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    const dialog = await screen.findByRole('dialog', { name: 'Detalle del hito' })
    expect(dialog).toHaveTextContent('Pie')
  })

  it('goes full screen on mobile when asked', async () => {
    window.innerWidth = 375
    try {
      mockSignedIn()
      const user = userEvent.setup()
      renderWithProviders(<ModalHarness fullScreenOnMobile />)
      await user.click(await screen.findByRole('button', { name: 'Abrir' }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog.parentElement).toHaveClass('fullScreen')
    } finally {
      window.innerWidth = 1024
    }
  })
})

describe('Modal: pulled down to close (swipeToClose)', () => {
  afterEach(() => {
    window.innerWidth = 1024
    window.getSelection()?.removeAllRanges()
  })

  async function openPanel({ width = 375, ...props }: Partial<ModalProps> & { width?: number } = {}) {
    window.innerWidth = width
    mockSignedIn()
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<ModalHarness fullScreenOnMobile swipeToClose onChange={onChange} {...props} />)
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo evento' })
    const overlay = dialog.closest<HTMLElement>('.overlay') as HTMLElement
    const body = dialog.querySelector<HTMLElement>('.body') as HTMLElement
    return { overlay, body, content: screen.getByText('Contenido'), onChange }
  }

  /** A finger pressing `target` at `from`, moving to `to` (through a first step) and lifting; whether the first move was left to the browser. */
  function pull(target: Element, from: [number, number], to: [number, number]): boolean {
    fireTouch(target, 'touchstart', [from])
    const step: [number, number] = [from[0] + (to[0] - from[0]) / 10, from[1] + (to[1] - from[1]) / 10]
    const leftAlone = fireTouch(target, 'touchmove', [step])
    fireTouch(target, 'touchmove', [to])
    fireTouch(target, 'touchend', [], { changed: [to] })
    return leftAlone
  }

  it('closes a full-screen panel pulled down from the top of its content, like the close button', async () => {
    const { overlay, content, onChange } = await openPanel()
    expect(overlay).toHaveClass('swipeable')
    fireTouch(content, 'touchstart', [[180, 300]])
    // Heading down: the panel follows instead of the content bouncing.
    expect(fireTouch(content, 'touchmove', [[180, 330]])).toBe(false)
    fireTouch(content, 'touchmove', [[180, 640]])
    expect(overlay).toHaveAttribute('data-swipe', 'drag')
    expect(overlay.style.getPropertyValue('--swipe-y')).toBe('310px')

    // It closes at once, and leaves from where the finger let go.
    fireTouch(content, 'touchend', [], { changed: [[180, 640]] })
    expect(onChange).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('lets the content scroll back up first, and leaves upward and sideways swipes alone', async () => {
    const { overlay, body, content, onChange } = await openPanel()
    Object.defineProperty(body, 'scrollTop', { configurable: true, value: 120 })
    expect(pull(content, [180, 300], [180, 640])).toBe(true)
    Object.defineProperty(body, 'scrollTop', { configurable: true, value: 0 })
    expect(pull(content, [180, 600], [180, 200])).toBe(true)
    expect(pull(content, [300, 300], [60, 380])).toBe(true)
    expect(overlay).not.toHaveAttribute('data-swipe')
    expect(onChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('dialog', { name: 'Nuevo evento' })).toBeInTheDocument()
  })

  it('leaves a text selection in it to be adjusted', async () => {
    const { overlay, content, onChange } = await openPanel()
    window.getSelection()?.selectAllChildren(content)
    expect(pull(content, [180, 300], [180, 640])).toBe(true)
    expect(overlay).not.toHaveAttribute('data-swipe')
    expect(onChange).not.toHaveBeenCalledWith(false)
  })

  it('takes the finger’s pointer once it follows it, so a button the pull started on does not take the release for a press', async () => {
    const { overlay, content } = await openPanel()
    const capture = vi.spyOn(overlay, 'setPointerCapture')
    const finger = (pointerId: number) => ({ pointerId, pointerType: 'touch', isPrimary: true, button: 0 })
    // A sideways swipe stays the browser's (and the button's to cancel).
    fireEvent.pointerDown(content, finger(7))
    pull(content, [300, 300], [60, 380])
    expect(capture).not.toHaveBeenCalled()

    fireEvent.pointerDown(content, finger(8))
    fireTouch(content, 'touchstart', [[180, 300]])
    fireTouch(content, 'touchmove', [[180, 304]])
    expect(capture).not.toHaveBeenCalled()
    fireTouch(content, 'touchmove', [[180, 330]])
    expect(capture).toHaveBeenCalledExactlyOnceWith(8)
    fireTouch(content, 'touchmove', [[180, 400]])
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('is for full-screen panels on phones only, when asked', async () => {
    const desktop = await openPanel({ width: 1024 })
    expect(desktop.overlay).not.toHaveClass('swipeable')
    expect(pull(desktop.content, [180, 300], [180, 640])).toBe(true)
    expect(desktop.onChange).not.toHaveBeenCalledWith(false)
  })

  it('is off unless asked', async () => {
    const phone = await openPanel({ swipeToClose: false })
    expect(phone.overlay).not.toHaveClass('swipeable')
    expect(pull(phone.content, [180, 300], [180, 640])).toBe(true)
    expect(phone.onChange).not.toHaveBeenCalledWith(false)
  })

  it('comes back when its owner keeps it open', async () => {
    window.innerWidth = 375
    mockSignedIn()
    const onOpenChange = vi.fn()
    renderWithProviders(
      <Modal isOpen onOpenChange={onOpenChange} title="Nuevo evento" fullScreenOnMobile swipeToClose>
        <p>Contenido</p>
      </Modal>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo evento' })
    const overlay = dialog.closest<HTMLElement>('.overlay') as HTMLElement
    vi.useFakeTimers()
    pull(screen.getByText('Contenido'), [180, 300], [180, 640])
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(overlay).toHaveAttribute('data-swipe', 'close')
    act(() => vi.advanceTimersByTime(1000))
    expect(overlay).not.toHaveAttribute('data-swipe')
    expect(overlay.style.getPropertyValue('--swipe-y')).toBe('')
  })
})

function ConfirmHarness({ onConfirm }: { onConfirm: () => unknown }) {
  const [open, setOpen] = useState(true)
  return (
    <ConfirmDialog isOpen={open} onOpenChange={setOpen} title="¿Mover a la papelera?" confirmLabel="Eliminar" onConfirm={onConfirm}>
      Podrás restaurarlo desde la Papelera.
    </ConfirmDialog>
  )
}

describe('ConfirmDialog', () => {
  it('is an alert dialog that confirms and closes after the promise resolves', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    const onConfirm = vi.fn(() => Promise.resolve())
    renderWithProviders(<ConfirmHarness onConfirm={onConfirm} />)
    const dialog = await screen.findByRole('alertdialog', { name: '¿Mover a la papelera?' })
    expect(dialog).toHaveTextContent('Podrás restaurarlo desde la Papelera.')
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('stays open and shows the translated error when the action fails', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    renderWithProviders(
      <ConfirmHarness onConfirm={() => Promise.reject(new ApiError({ status: 409, code: 'category_in_use', detail: { events: 1 } }))} />,
    )
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se puede eliminar porque 1 hito usa esta categoría (la papelera también cuenta).',
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('cancels without confirming', async () => {
    mockSignedIn()
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderWithProviders(<ConfirmHarness onConfirm={onConfirm} />)
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
