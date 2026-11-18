// Push notifications: the account panel's switch, its hints and the first-run invite.
export const push = {
  title: 'Notificaciones de este dispositivo',
  switch: 'Activar notificaciones',
  description: 'Recibirás en este dispositivo los recuerdos de cada día, a las 9:00.',
  enabled: 'Listo: las notificaciones están activadas en este dispositivo.',
  test: 'Enviar una notificación de prueba',
  tested: 'Notificación enviada: llegará en unos segundos.',
  error: 'No se han podido activar las notificaciones en este dispositivo.',
  install:
    'Para recibir notificaciones en el iPhone o el iPad, añade Timelife a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde allí.',
  denied: 'Las notificaciones de Timelife están bloqueadas en este dispositivo: permítelas en los ajustes del navegador o del sistema.',
  invite: {
    message: '¿Activamos las notificaciones? Te avisaremos de los recuerdos de cada día.',
    action: 'Activar',
  },
} as const
