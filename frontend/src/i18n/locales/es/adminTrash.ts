// Namespace owned by frontend-admin-events: trash of soft-deleted events. English mirrors these keys.
export const adminTrash = {
  description: 'Los eventos eliminados se guardan aquí hasta que los restaures o los borres para siempre.',
  listLabel: 'Eventos en la papelera',
  count: { one: '{count} evento en la papelera', other: '{count} eventos en la papelera' },
  deletedAt: 'Eliminado el {date}',
  deletedBy: 'Eliminado el {date} por {name}',
  restore: 'Restaurar',
  restoreLabel: 'Restaurar «{title}»',
  restored: '«{title}» se ha restaurado.',
  edit: 'Editar',
  purge: 'Eliminar definitivamente',
  purgeLabel: 'Eliminar definitivamente «{title}»',
  purgeTitle: '¿Eliminar para siempre?',
  purgeMessage: {
    zero: '«{title}» se borrará definitivamente. Esta acción no se puede deshacer.',
    one: '«{title}» y su foto se borrarán definitivamente. Esta acción no se puede deshacer.',
    other: '«{title}» y sus {count} fotos se borrarán definitivamente. Esta acción no se puede deshacer.',
  },
  /** `purgeMessage` of an event with videos (`count`: photos and videos). */
  purgeMediaMessage: {
    one: '«{title}» y su vídeo se borrarán definitivamente. Esta acción no se puede deshacer.',
    other: '«{title}» y sus {count} fotos y vídeos se borrarán definitivamente. Esta acción no se puede deshacer.',
  },
  purgeConfirm: 'Eliminar para siempre',
  purged: '«{title}» se ha eliminado definitivamente.',
  empty: {
    title: 'La papelera está vacía',
    description: 'Cuando elimines un evento aparecerá aquí y podrás restaurarlo.',
    action: 'Ir a eventos',
  },
  loadError: 'No se ha podido cargar la papelera.',
} as const
