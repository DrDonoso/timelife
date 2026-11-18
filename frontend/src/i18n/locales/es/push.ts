// Push notifications: the account panel's switch, its hints and the first-run invite.
export const push = {
  title: 'Avisos de este dispositivo',
  switch: 'Avisarme de los recuerdos',
  description: 'Un aviso a las 9:00 los días con recuerdos, en este dispositivo.',
  enabled: 'Listo: te avisaremos a las 9:00 los días con recuerdos.',
  test: 'Enviar un aviso de prueba',
  tested: 'Aviso enviado: llegará en unos segundos.',
  error: 'No se han podido activar los avisos en este dispositivo.',
  install:
    'Para recibir avisos en el iPhone o el iPad, añade Timelife a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde allí.',
  denied: 'Los avisos de Timelife están bloqueados en este dispositivo: permítelos en los ajustes del navegador o del sistema.',
  invite: {
    message: '¿Te avisamos los días con recuerdos? Llegan a las 9:00.',
    action: 'Activar',
  },
} as const
