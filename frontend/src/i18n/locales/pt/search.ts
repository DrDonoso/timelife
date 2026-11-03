import type { Messages } from '../../types'
import type { search as source } from '../es/search'

export const search: Messages<typeof source> = {
  bar: {
    label: 'Pesquisar marcos',
    placeholder: 'Pesquisar marcos…',
    clear: 'Apagar a pesquisa',
    shortcut: 'Prime / para pesquisar',
    results: 'Marcos encontrados',
    searching: 'A pesquisar…',
    noResults: 'Nenhum marco corresponde a «{query}».',
    noResultsFiltered: 'Os filtros de datas ou categorias também se aplicam.',
    error: 'Não foi possível pesquisar. Tenta novamente.',
    more: 'A mostrar {shown} de {count}. Prime Enter para os ver todos na linha do tempo.',
  },
  toggle: {
    label: 'Filtros',
    active: { one: 'Filtros ({count} ativo)', other: 'Filtros ({count} ativos)' },
  },
  panel: {
    title: 'Filtros',
    close: 'Fechar filtros',
    searchTitle: 'Pesquisa',
    removeSearch: 'Remover a pesquisa «{query}»',
    datesTitle: 'Datas',
    from: 'Desde',
    to: 'Até',
    rangeError: 'Tem de ser igual ou posterior a «Desde».',
    yearRange: 'Escolhe um ano entre {min} e {max}.',
    presets: {
      label: 'Intervalos rápidos',
      thisYear: 'Este ano',
      last12Months: 'Últimos 12 meses',
      lastYear: 'Ano passado',
    },
    categoriesTitle: 'Categorias',
    categoriesEmpty: 'Ainda não há categorias.',
    categoriesError: 'Não foi possível carregar as categorias.',
    count: { one: '{shown} de {count} marco', other: '{shown} de {count} marcos' },
    counting: 'A contar os marcos…',
    countError: 'Não foi possível contar os marcos.',
    clear: 'Limpar filtros',
    showResults: { zero: 'Nenhum marco', one: 'Ver {count} marco', other: 'Ver {count} marcos' },
  },
}
