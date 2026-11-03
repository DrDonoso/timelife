import { lazy, type ComponentType } from 'react'
import type { EventEditorProps } from '../admin/events/EventEditor'

let editorModule: Promise<{ default: ComponentType<EventEditorProps> }> | null = null

/** The editor chunk shared by the event card and the timeline's "new milestone" modal, requested once. */
export function loadEditor() {
  editorModule ??= import('../admin/events/EventEditor').then(
    (module) => ({ default: module.EventEditor }),
    (error: unknown) => {
      // Let a later attempt try again.
      editorModule = null
      throw error
    },
  )
  return editorModule
}

export const LazyEventEditor = lazy(loadEditor)

/** Starts downloading the editor (e.g. when an admin points at the pencil). */
export function preloadEditor() {
  loadEditor().catch(() => {
    // Reported by the editor boundary if the editor is really opened.
  })
}
