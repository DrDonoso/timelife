import type { Messages } from '../../types'
import type { detail as source } from '../es/detail'

// Event detail card (owned by frontend-detail).
export const detail: Messages<typeof source> = {
  dialogLabel: 'Detalhes do marco',
  loading: 'A carregar o marco…',
  close: 'Fechar',
  edit: 'Editar marco',
  editing: 'A editar «{title}»',
  saved: 'Alterações guardadas',
  date: 'Data',
  location: 'Local',
  categories: 'Categorias',
  children: 'Crianças deste marco',
  notFound: {
    title: 'Não encontrámos este marco',
    description: 'Pode ter sido eliminado ou a ligação pode já não ser válida.',
    action: 'Voltar à linha do tempo',
  },
  loadError: {
    title: 'Não foi possível carregar o marco',
  },
  leaveEditor: {
    title: 'Sair sem guardar?',
    message: 'Se saíres agora, vais perder as alterações que não guardaste.',
    confirm: 'Sair sem guardar',
    stay: 'Continuar a editar',
  },
  editorError: {
    title: 'Não foi possível abrir o editor',
    description: 'Verifica a tua ligação e tenta novamente.',
    back: 'Voltar ao marco',
  },
  carousel: {
    label: 'Fotos de «{title}»',
    mediaLabel: 'Fotos e vídeos de «{title}»',
    roleDescription: 'carrossel',
    slideRoleDescription: 'foto',
    videoRoleDescription: 'vídeo',
    slideLabel: '{current} de {total}',
    previous: 'Foto anterior',
    next: 'Foto seguinte',
    pagination: 'Escolher foto',
    goTo: 'Ver a foto {current} de {total}',
    status: 'Foto {current} de {total}: {name}',
    imageError: 'Não foi possível carregar esta foto',
    videoProcessing: 'A preparar o vídeo…',
    videoFailed: 'Não é possível reproduzir este vídeo',
    playLive: 'Reproduzir a foto Live «{name}»',
    liveTag: 'LIVE',
  },
  viewer: {
    open: 'Ver a foto em ecrã inteiro',
    label: 'Fotos de «{title}» em ecrã inteiro',
    mediaLabel: 'Fotos e vídeos de «{title}» em ecrã inteiro',
    close: 'Sair do ecrã inteiro',
  },
}
