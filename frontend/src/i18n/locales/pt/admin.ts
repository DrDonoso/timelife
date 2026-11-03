import type { Messages } from '../../types'
import type { admin as source } from '../es/admin'

export const admin: Messages<typeof source> = {
  title: 'Administração',
  nav: {
    label: 'Secções',
    events: 'Eventos',
    categories: 'Categorias',
    children: 'Crianças',
    appearance: 'Cores e aparência',
    users: 'Utilizadores',
    trash: 'Lixo',
    backup: 'Importar e exportar',
  },
  backToTimeline: 'Voltar à linha do tempo',
  openMenu: 'Abrir menu de administração',
  closeMenu: 'Fechar menu',
  version: 'Versão {version}',
  versionWithDate: 'Versão {version} · {date}',
  discardChanges: {
    title: 'Descartar as alterações?',
    message: 'Tens alterações por guardar. Se fechares agora, vais perdê-las.',
    confirm: 'Descartar alterações',
    stay: 'Continuar a editar',
  },
  notFound: {
    title: 'Secção não encontrada',
    description: 'Esta página de administração não existe.',
    action: 'Ir para os eventos',
  },
}
