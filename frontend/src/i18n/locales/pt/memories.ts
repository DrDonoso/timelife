import type { Messages } from '../../types'
import type { memories as source } from '../es/memories'

export const memories: Messages<typeof source> = {
  button: {
    label: 'Memórias',
    unseen: { one: 'Memórias ({count} nova hoje)', other: 'Memórias ({count} novas hoje)' },
  },
  title: 'Memórias de hoje',
  loading: 'À procura de memórias…',
  error: 'Não foi possível carregar as memórias.',
  ago: {
    months: { one: 'há {count} mês', other: 'há {count} meses' },
    years: { one: 'há {count} ano', other: 'há {count} anos' },
  },
  empty: 'Hoje não há memórias.',
  next: { one: 'A próxima, a {date}:', other: 'As próximas, a {date}:' },
  nextMore: 'E mais {count} nesse dia.',
  none: 'Quando os marcos fizerem meses ou anos, vais vê-los aqui.',
  toast: {
    single: 'Neste dia, {ago}: «{title}».',
    several: {
      one: 'Neste dia, {ago}: «{title}» e mais {count} memória.',
      other: 'Neste dia, {ago}: «{title}» e mais {count} memórias.',
    },
    action: 'Ver',
  },
}
