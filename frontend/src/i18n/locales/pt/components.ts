import type { Messages } from '../../types'
import type { components as source } from '../es/components'

export const components: Messages<typeof source> = {
  modal: {
    close: 'Fechar',
  },
  spinner: {
    label: 'A carregar',
  },
  toast: {
    dismiss: 'Fechar notificação',
  },
  select: {
    placeholder: 'Seleciona uma opção',
  },
  textArea: {
    counter: '{count} / {max}',
  },
  passwordField: {
    show: 'Mostrar palavra-passe',
    hide: 'Ocultar palavra-passe',
  },
  colorInput: {
    open: 'Escolher cor',
    hex: 'Código da cor',
    hue: 'Matiz',
    area: 'Saturação e brilho',
    presets: 'Cores sugeridas',
    invalid: 'Escreve uma cor hexadecimal, por exemplo #3b82f6.',
  },
  iconPicker: {
    search: 'Pesquisar ícone',
    results: { zero: 'Nenhum ícone', one: '{count} ícone', other: '{count} ícones' },
    noResults: 'Nenhum ícone corresponde a «{query}».',
  },
  dateField: {
    openCalendar: 'Abrir calendário',
    previousMonth: 'Mês anterior',
    nextMonth: 'Mês seguinte',
    today: 'Hoje',
    clear: 'Apagar data',
  },
  chipMultiSelect: {
    selected: 'Selecionados',
    available: 'Disponíveis',
    noneSelected: 'Ainda não há nada selecionado.',
    primary: 'Principal',
    orderHint: 'A ordem importa: o primeiro é o principal.',
    moveEarlier: 'Mover {label} para antes',
    moveLater: 'Mover {label} para depois',
    remove: 'Remover {label}',
    add: 'Adicionar {label}',
  },
  categoryBadges: {
    more: { one: 'Mais {count} categoria', other: 'Mais {count} categorias' },
  },
  avatarGroup: {
    more: { one: 'Mais {count}', other: 'Mais {count}' },
  },
}
