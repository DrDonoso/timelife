import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useI18n } from '../i18n'

const leavesPage: BlockerFunction = ({ currentLocation, nextLocation }) =>
  currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search

/** `allowLeave` when none is given: never set. */
const STAY: RefObject<boolean> = { current: false }

/**
 * Mounted while the card is in edit mode: when the editor has unsaved changes (`when`), the browser
 * Back button (or any other navigation) asks before throwing them away. The editor's own Cancel /
 * Save buttons don't navigate. `allowLeave` is set when leaving on purpose (saved, or changes
 * discarded): a closing modal keeps rendering its last props, `when` included, until it is gone.
 */
export function LeaveEditorGuard({ when, allowLeave = STAY }: { when: boolean; allowLeave?: RefObject<boolean> }) {
  const { t } = useI18n()
  const shouldBlock = useCallback<BlockerFunction>((args) => when && !allowLeave.current && leavesPage(args), [when, allowLeave])
  const blocker = useBlocker(shouldBlock)
  const proceeding = useRef(false)

  useEffect(() => {
    if (blocker.state === 'unblocked') proceeding.current = false
  }, [blocker.state])

  const stay = useCallback(
    (open: boolean) => {
      if (!open && !proceeding.current) blocker.reset?.()
    },
    [blocker],
  )

  return (
    <ConfirmDialog
      isOpen={blocker.state === 'blocked'}
      onOpenChange={stay}
      title={t('detail.leaveEditor.title')}
      confirmLabel={t('detail.leaveEditor.confirm')}
      cancelLabel={t('detail.leaveEditor.stay')}
      onConfirm={() => {
        proceeding.current = true
        blocker.proceed?.()
      }}
    >
      {t('detail.leaveEditor.message')}
    </ConfirmDialog>
  )
}
