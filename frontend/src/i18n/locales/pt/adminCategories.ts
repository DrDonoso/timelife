import type { Messages } from '../../types'
import type { adminCategories as source } from '../es/adminCategories'

// Namespace owned by frontend-admin-settings (Admin → Categorias).
export const adminCategories: Messages<typeof source> = {
  description:
    'Agrupam os marcos por tipo. A sua cor e o seu ícone aparecem na linha do tempo, e a sua ordem é a dos filtros e dos seletores.',
  new: 'Nova categoria',
  listLabel: 'Categorias (arrasta para ordenar)',
  count: { one: '{count} categoria', other: '{count} categorias' },
  loadError: 'Não foi possível carregar as categorias.',
  empty: {
    title: 'Ainda não há categorias',
    description: 'Cria a primeira para classificar os marcos, por exemplo «Primeiras palavras» ou «Sono».',
  },
  reorder: {
    hint: 'Arrasta as linhas ou usa as setas para alterar a ordem. É guardada automaticamente.',
    saving: 'A guardar a ordem…',
    saved: 'Ordem guardada',
    moved: '{name}: posição {position} de {total}.',
  },
  row: {
    drag: 'Arrastar {name} para alterar a ordem',
    moveUp: 'Mover {name} para cima',
    moveDown: 'Mover {name} para baixo',
    edit: 'Editar {name}',
    delete: 'Eliminar {name}',
    color: 'Cor',
    icon: 'Ícone',
  },
  form: {
    createTitle: 'Nova categoria',
    editTitle: 'Editar categoria',
    nameEs: 'Nome em espanhol',
    nameEn: 'Nome em inglês',
    namePt: 'Nome em português',
    // The examples are written in the language of each field.
    nameEsPlaceholder: 'Por ejemplo, Primeras palabras',
    nameEnPlaceholder: 'For example, First words',
    namePtPlaceholder: 'Por exemplo, Primeiras palavras',
    nameEsRequired: 'Escreve o nome em espanhol.',
    nameEnRequired: 'Escreve o nome em inglês.',
    namePtRequired: 'Escreve o nome em português.',
    tooLong: 'No máximo, {max} caracteres.',
    color: 'Cor',
    colorDescription: 'Escolhe uma das sugeridas ou qualquer outra.',
    colorInvalid: 'Escreve uma cor hexadecimal, por exemplo #3b82f6.',
    icon: 'Ícone',
    iconRequired: 'Escolhe um ícone.',
    create: 'Criar categoria',
    save: 'Guardar alterações',
  },
  preview: {
    title: 'Pré-visualização',
    light: 'Modo claro',
    dark: 'Modo escuro',
    sampleTitle: 'Primeiro marco',
    placeholderName: 'Nova categoria',
    contrastNote:
      'Para que o texto branco se leia bem, as etiquetas e os emblemas usam um tom um pouco mais intenso desta cor.',
  },
  delete: {
    title: 'Eliminar «{name}»?',
    message:
      'Só pode ser eliminada se nenhum marco a usar, nem mesmo os que estão no lixo. Esta ação não pode ser anulada.',
    confirm: 'Eliminar categoria',
  },
  toast: {
    created: 'Categoria «{name}» criada.',
    updated: 'Categoria «{name}» guardada.',
    deleted: 'Categoria «{name}» eliminada.',
  },
}
