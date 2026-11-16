import type { Messages } from '../../types'
import type { whatsNew as source } from '../es/whatsNew'

export const whatsNew: Messages<typeof source> = {
  title: 'Novidades',
  intro: 'Isto é o que há de novo no Timelife desde a última vez que entraste.',
  allIntro: 'Tudo o que foi chegando ao Timelife, do mais recente ao mais antigo.',
  empty: 'Ainda não há novidades.',
  gotIt: 'Entendido!',
  showMore: { one: 'Ver mais {count} novidade', other: 'Ver mais {count} novidades' },
  goThere: 'Leva-me lá',
  adminsOnly: 'Só para administradores',
  kinds: {
    new: 'Novo',
    improved: 'Melhorado',
    fixed: 'Corrigido',
  },
}
