import type { Messages } from '../../types'
import type { push as source } from '../es/push'

export const push: Messages<typeof source> = {
  title: 'Notificações deste dispositivo',
  switch: 'Ativar notificações',
  description: 'Recebes neste dispositivo as memórias de cada dia, às 9:00.',
  enabled: 'Pronto: as notificações estão ativadas neste dispositivo.',
  test: 'Enviar uma notificação de teste',
  tested: 'Notificação enviada: chega dentro de segundos.',
  error: 'Não foi possível ativar as notificações neste dispositivo.',
  install:
    'Para receberes notificações no iPhone ou no iPad, adiciona o Timelife ao ecrã principal (Partilhar → Adicionar ao ecrã principal) e abre-o a partir daí.',
  denied: 'As notificações do Timelife estão bloqueadas neste dispositivo: permite-as nas definições do navegador ou do sistema.',
  invite: {
    message: 'Ativamos as notificações? Avisamos-te das memórias de cada dia.',
    action: 'Ativar',
  },
}
