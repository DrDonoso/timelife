import type { Messages } from '../../types'
import type { adminTrash as source } from '../es/adminTrash'

// Namespace owned by frontend-admin-events (mirrors ../es/adminTrash.ts).
export const adminTrash: Messages<typeof source> = {
  description: 'Os eventos eliminados ficam guardados aqui até os restaurares ou os apagares para sempre.',
  listLabel: 'Eventos no lixo',
  count: { one: '{count} evento no lixo', other: '{count} eventos no lixo' },
  deletedAt: 'Eliminado em {date}',
  deletedBy: 'Eliminado em {date} por {name}',
  restore: 'Restaurar',
  restoreLabel: 'Restaurar «{title}»',
  restored: '«{title}» foi restaurado.',
  edit: 'Editar',
  purge: 'Eliminar definitivamente',
  purgeLabel: 'Eliminar definitivamente «{title}»',
  purgeTitle: 'Eliminar para sempre?',
  purgeMessage: {
    zero: '«{title}» vai ser apagado definitivamente. Esta ação não pode ser anulada.',
    one: '«{title}» e a sua foto vão ser apagados definitivamente. Esta ação não pode ser anulada.',
    other: '«{title}» e as suas {count} fotos vão ser apagados definitivamente. Esta ação não pode ser anulada.',
  },
  /** `purgeMessage` of an event with videos (`count`: photos and videos). */
  purgeMediaMessage: {
    one: '«{title}» e o seu vídeo vão ser apagados definitivamente. Esta ação não pode ser anulada.',
    other: '«{title}» e as suas {count} fotos e vídeos vão ser apagados definitivamente. Esta ação não pode ser anulada.',
  },
  purgeConfirm: 'Eliminar para sempre',
  purged: '«{title}» foi eliminado definitivamente.',
  empty: {
    title: 'O lixo está vazio',
    description: 'Quando eliminares um evento, vai aparecer aqui e vais poder restaurá-lo.',
    action: 'Ir para os eventos',
  },
  loadError: 'Não foi possível carregar o lixo.',
}
