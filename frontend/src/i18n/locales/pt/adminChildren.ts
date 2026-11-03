import type { Messages } from '../../types'
import type { adminChildren as source } from '../es/adminChildren'

// Namespace owned by frontend-admin-settings (Admin → Crianças).
export const adminChildren: Messages<typeof source> = {
  description: 'Cada criança tem a sua própria linha do tempo. Um mesmo marco pode pertencer a várias crianças.',
  new: 'Adicionar criança',
  listLabel: 'Crianças (arrasta para ordenar)',
  count: { one: '{count} criança', other: '{count} crianças' },
  loadError: 'Não foi possível carregar as crianças.',
  empty: {
    title: 'Ainda não há crianças',
    description: 'Adiciona a primeira para começar a guardar os seus marcos.',
  },
  reorder: {
    hint: 'Arrasta os cartões ou usa as setas para alterar a ordem do seletor de crianças.',
    saving: 'A guardar a ordem…',
    saved: 'Ordem guardada',
    moved: '{name}: posição {position} de {total}.',
  },
  card: {
    born: 'Nasceu a {date}',
    noBirthDate: 'Sem data de nascimento',
    ageMonths: { zero: 'menos de 1 mês', one: '{count} mês', other: '{count} meses' },
    ageYears: { one: '{count} ano', other: '{count} anos' },
    drag: 'Arrastar {name} para alterar a ordem',
    moveEarlier: 'Mover {name} para antes',
    moveLater: 'Mover {name} para depois',
    edit: 'Editar {name}',
    delete: 'Eliminar {name}',
  },
  form: {
    createTitle: 'Adicionar criança',
    editTitle: 'Editar {name}',
    name: 'Nome',
    namePlaceholder: 'Por exemplo, Lúcia',
    nameRequired: 'Escreve o nome.',
    tooLong: 'No máximo, {max} caracteres.',
    birthDate: 'Data de nascimento',
    birthDateHelp: 'Opcional.',
    birthDateInvalid: 'A data não é válida.',
    waitUpload: 'Espera que a foto acabe de carregar.',
    create: 'Adicionar criança',
    save: 'Guardar alterações',
  },
  avatar: {
    label: 'Foto',
    upload: 'Carregar foto',
    change: 'Alterar foto',
    remove: 'Remover foto',
    restore: 'Recuperar a foto',
    hint: 'JPEG, PNG, WebP ou HEIC. É mostrada recortada num círculo.',
    removed: 'A foto será eliminada quando guardares.',
    gone: 'Esta foto já não está disponível. Volta a carregá-la.',
  },
  upload: {
    uploading: 'A carregar {name}…',
    cancel: 'Cancelar carregamento',
    dismiss: 'Descartar',
    failed: 'Não foi possível carregar a imagem. {error}',
  },
  delete: {
    title: 'Eliminar {name}?',
    message:
      'A sua foto também será apagada. Só é possível eliminar uma criança se não tiver marcos, nem mesmo no lixo. Esta ação não pode ser anulada.',
    confirm: 'Eliminar',
  },
  toast: {
    created: 'Adicionaste {name}.',
    updated: 'Alterações de {name} guardadas.',
    deleted: 'Eliminaste {name}.',
  },
}
