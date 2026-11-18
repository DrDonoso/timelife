import type { Messages } from '../../types'
import type { push as source } from '../es/push'

export const push: Messages<typeof source> = {
  title: 'Notificações deste dispositivo',
  switch: 'Ativar notificações',
  enabled: 'Pronto: as notificações estão ativadas neste dispositivo.',
  error: 'Não foi possível ativar as notificações neste dispositivo.',
  install:
    'Para receberes notificações no iPhone ou no iPad, adiciona o Timelife ao ecrã principal (Partilhar → Adicionar ao ecrã principal) e abre-o a partir daí.',
  denied: 'As notificações do Timelife estão bloqueadas neste dispositivo: permite-as nas definições do navegador ou do sistema.',
  invite: {
    message: 'Ativamos as notificações? Avisamos-te das memórias de cada dia e dos novos marcos.',
    action: 'Ativar',
  },
  choose: 'Escolher notificações',
  choices: {
    intro: 'Escolhe as que queres receber. Valem para todos os teus dispositivos com as notificações ativadas.',
    memories: { label: 'Memórias do dia', description: 'Às 9:00, nos dias com memórias.' },
    milestones: { label: 'Novos marcos', description: 'Quando outra pessoa adiciona um marco.' },
    error: 'Não foi possível carregar as tuas notificações.',
    done: 'Concluído',
  },
}
