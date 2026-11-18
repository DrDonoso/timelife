import type { Messages } from '../../types'
import type { push as source } from '../es/push'

export const push: Messages<typeof source> = {
  title: 'Avisos deste dispositivo',
  switch: 'Avisar-me das memórias',
  description: 'Um aviso às 9:00 nos dias com memórias, neste dispositivo.',
  enabled: 'Pronto: avisamos-te às 9:00 nos dias com memórias.',
  test: 'Enviar um aviso de teste',
  tested: 'Aviso enviado: chega dentro de segundos.',
  error: 'Não foi possível ativar os avisos neste dispositivo.',
  install:
    'Para receberes avisos no iPhone ou no iPad, adiciona o Timelife ao ecrã principal (Partilhar → Adicionar ao ecrã principal) e abre-o a partir daí.',
  denied: 'Os avisos do Timelife estão bloqueados neste dispositivo: permite-os nas definições do navegador ou do sistema.',
  invite: {
    message: 'Queres que te avisemos nos dias com memórias? Chegam às 9:00.',
    action: 'Ativar',
  },
}
