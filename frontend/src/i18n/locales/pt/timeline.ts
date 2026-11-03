import type { Messages } from '../../types'
import type { timeline as source } from '../es/timeline'

// Namespace owned by frontend-timeline (mirrors ../es/timeline.ts).
export const timeline: Messages<typeof source> = {
  regionLabel: 'Linha do tempo de {name}',
  family: {
    name: 'Todos juntos',
    regionLabel: 'Linha do tempo de todos juntos',
    empty: 'Ainda não há marcos',
  },
  listLabel: {
    years: { one: 'Anos com marcos: {count} ano', other: 'Anos com marcos: {count} anos' },
    months: { one: 'Meses com marcos: {count} mês', other: 'Meses com marcos: {count} meses' },
    events: { one: '{count} marco', other: '{count} marcos' },
  },
  levels: {
    years: 'Anos',
    months: 'Meses',
    events: 'Dias',
  },
  levelView: {
    years: 'Vista por anos',
    months: 'Vista por meses',
    events: 'Vista por dias',
  },
  zoom: {
    group: 'Zoom da linha do tempo',
    level: 'Nível de detalhe',
    in: 'Ampliar',
    out: 'Reduzir',
    inShortcut: 'Ampliar (+)',
    outShortcut: 'Reduzir (−)',
  },
  count: { zero: 'Sem marcos', one: '{count} marco', other: '{count} marcos' },
  hubLabel: { one: '{period} · {count} marco', other: '{period} · {count} marcos' },
  eventLabel: '{title} · {date}',
  eventLabelWithCategories: '{title} · {date} · {categories}',
  eventLabelPeople: '{label} · {people}',
  announce: {
    one: '{level} · {count} elemento',
    other: '{level} · {count} elementos',
  },
  hint: 'Ctrl + roda do rato ou gesto de pinça para alterar o zoom',
  loading: 'A carregar a linha do tempo…',
  empty: {
    title: 'Ainda não há marcos de {name}',
    descriptionAdmin: 'Adiciona o primeiro e começa a construir a sua linha do tempo.',
    descriptionViewer: 'Quando forem adicionados marcos, vão aparecer aqui.',
    action: 'Adicionar o primeiro marco',
  },
  noResults: {
    title: 'Nenhum marco corresponde à pesquisa',
    description: 'Experimenta outras palavras, outras datas ou outras categorias.',
    action: 'Limpar filtros',
  },
  error: {
    title: 'Não foi possível carregar a linha do tempo',
    retry: 'Tentar novamente',
  },
  create: {
    action: 'Novo marco',
    title: 'Novo marco',
  },
}
