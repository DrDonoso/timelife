import { IconArrowRight } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { Button, LinkButton } from '../components/Button'
import { Modal } from '../components/Modal'
import { cx, renderIcon } from '../components/utils'
import { useI18n } from '../i18n'
import { noteIcon } from './icons'
import { byMonth, type Note } from './notes'
import styles from './WhatsNew.module.css'

/** News shown before «Ver N novedades más». */
export const NEWS_SHOWN = 6

interface NoteCardProps {
  note: Note
  /** Under the dialog's title (h3), or under a month (h4). */
  heading: 'h4' | 'h5'
  /** Its link was followed: the dialog closes. */
  onLeave: () => void
  /** Moves focus to its title (the first of the notes «Ver más» reveals). */
  focusTitle?: boolean
}

function NoteCard({ note, heading: Heading, onLeave, focusTitle = false }: NoteCardProps) {
  const { t, lang } = useI18n()
  const title = useRef<HTMLHeadingElement>(null)
  const text = note[lang]
  useEffect(() => {
    if (focusTitle) title.current?.focus()
  }, [focusTitle])
  return (
    <li className={cx(styles.note, styles[note.kind])}>
      <span className={styles.icon} aria-hidden="true">
        {renderIcon(noteIcon(note), 22)}
      </span>
      <div className={styles.text}>
        <p className={styles.tags}>
          <span className={styles.kind}>{t(`whatsNew.kinds.${note.kind}`)}</span>
          {note.audience === 'admins' && <span className={styles.audience}>{t('whatsNew.adminsOnly')}</span>}
        </p>
        <Heading ref={title} className={styles.title} tabIndex={focusTitle ? -1 : undefined}>
          {text.title}
        </Heading>
        <p className={styles.body}>{text.body}</p>
        {note.link && (
          <LinkButton href={note.link} size="sm" iconEnd={IconArrowRight} onPress={onLeave} className={styles.go}>
            {t('whatsNew.goThere')}
          </LinkButton>
        )}
      </div>
    </li>
  )
}

interface DialogProps {
  isOpen: boolean
  /** Closed in any way (button, ×, Esc, outside, a note's link). */
  onClose: () => void
  notes: readonly Note[]
}

function closeWith(onClose: () => void) {
  return (isOpen: boolean) => {
    if (!isOpen) onClose()
  }
}

/** What is new since the user last looked (the first {@link NEWS_SHOWN}, then all of them on request). */
export function NewsDialog({ isOpen, onClose, notes }: DialogProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? notes : notes.slice(0, NEWS_SHOWN)
  const hidden = notes.length - shown.length
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={closeWith(onClose)}
      title={t('whatsNew.title')}
      bodyLabel={t('whatsNew.title')}
      fullScreenOnMobile
      swipeToClose
      footer={
        <Button variant="primary" onPress={onClose}>
          {t('whatsNew.gotIt')}
        </Button>
      }
    >
      {(close) => (
        <>
          <p className={styles.intro}>{t('whatsNew.intro')}</p>
          <ul role="list" className={styles.notes}>
            {shown.map((note, index) => (
              <NoteCard key={note.id} note={note} heading="h4" onLeave={close} focusTitle={expanded && index === NEWS_SHOWN} />
            ))}
          </ul>
          {hidden > 0 && (
            <Button variant="ghost" onPress={() => setExpanded(true)} className={styles.more}>
              {t('whatsNew.showMore', { count: hidden })}
            </Button>
          )}
        </>
      )}
    </Modal>
  )
}

/** Every note, by month, newest first. */
export function AllNotesDialog({ isOpen, onClose, notes }: DialogProps) {
  const { t, formatDate, locale } = useI18n()
  const months = byMonth(notes)
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={closeWith(onClose)}
      title={t('whatsNew.title')}
      bodyLabel={t('whatsNew.title')}
      fullScreenOnMobile
      swipeToClose
    >
      {(close) => (
        <>
          <p className={styles.intro}>{t(months.length > 0 ? 'whatsNew.allIntro' : 'whatsNew.empty')}</p>
          {months.map(({ month, notes: monthNotes }) => {
            const name = formatDate(month, 'monthYearLong')
            return (
              <div key={month} className={styles.month}>
                <h4 className={styles.monthTitle}>{name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)}</h4>
                <ul role="list" className={styles.notes}>
                  {monthNotes.map((note) => (
                    <NoteCard key={note.id} note={note} heading="h5" onLeave={close} />
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
    </Modal>
  )
}
