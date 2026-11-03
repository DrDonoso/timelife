import type { Messages } from '../../types'
import type { shell as source } from '../es/shell'

export const shell: Messages<typeof source> = {
  skipToContent: 'Saltar para o conteúdo',
  home: 'Timelife, início',
  childSwitcher: {
    label: 'Mudar de criança',
    current: 'A ver {name}',
    all: 'Todos juntos',
    allDescription: 'Cada criança na sua linha',
  },
  search: {
    open: 'Pesquisar',
    close: 'Fechar pesquisa',
  },
  themeMenu: 'Tema: {palette} · Modo: {mode}',
  languageMenu: 'Idioma: {language}',
  userMenu: {
    label: 'Menu do utilizador',
    admin: 'Administração',
    timeline: 'Linha do tempo',
    signOut: 'Terminar sessão',
  },
  notifications: 'Notificações',
  noChildren: {
    title: 'Ainda não há crianças',
    descriptionAdmin: 'Adiciona a primeira criança para começar a guardar os seus marcos.',
    descriptionViewer: 'Quando um administrador adicionar as crianças, vais ver aqui os seus marcos.',
    action: 'Adicionar crianças',
  },
  childNotFound: {
    title: 'Não encontrámos esta criança',
    description: 'Pode ser que a ligação tenha mudado ou que já não exista.',
    action: 'Ver a linha do tempo',
  },
  childrenError: 'Não foi possível carregar as crianças.',
}
