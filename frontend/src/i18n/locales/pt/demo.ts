import type { Messages } from '../../types'
import type { demo as source } from '../es/demo'

export const demo: Messages<typeof source> = {
  welcome:
    'Damos-te as boas-vindas à demo do Timelife: uma família inventada com dados de exemplo. Podes experimentar tudo; as alterações ficam neste separador e, ao recarregar, voltam os dados originais.',
  reset: 'Reiniciar a demo',
}
