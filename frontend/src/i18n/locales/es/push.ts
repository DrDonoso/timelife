// Push notifications: the account panel's switch, the choice of which ones, its hints and the
// first-run invite.
export const push = {
  title: 'Notificaciones de este dispositivo',
  switch: 'Activar notificaciones',
  enabled: 'Listo: las notificaciones están activadas en este dispositivo.',
  error: 'No se han podido activar las notificaciones en este dispositivo.',
  install:
    'Para recibir notificaciones en el iPhone o el iPad, añade Timelife a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde allí.',
  denied: 'Las notificaciones de Timelife están bloqueadas en este dispositivo: permítelas en los ajustes del navegador o del sistema.',
  invite: {
    message: '¿Activamos las notificaciones? Te avisaremos de los recuerdos de cada día y de los hitos nuevos.',
    action: 'Activar',
  },
  /** The button of the account panel and the title of its window. */
  choose: 'Elegir notificaciones',
  choices: {
    intro: 'Elige las que quieres recibir. Valen para todos tus dispositivos con las notificaciones activadas.',
    memories: { label: 'Recuerdos del día', description: 'A las 9:00, los días con recuerdos.' },
    milestones: { label: 'Hitos nuevos', description: 'Cuando otra persona añade un hito.' },
    error: 'No se han podido cargar tus notificaciones.',
    done: 'Listo',
  },
} as const
