import type { Messages } from '../../types'
import type { adminBackup as source } from '../es/adminBackup'

export const adminBackup: Messages<typeof source> = {
  description: 'Transfere uma cópia completa do Timelife ou restaura uma cópia neste servidor.',
  size: '≈ {size}',
  summary: {
    events: { zero: 'Sem marcos', one: '{count} marco', other: '{count} marcos' },
    trashed: { one: '{count} no lixo', other: '{count} no lixo' },
    photos: { zero: 'Sem fotos', one: '{count} foto', other: '{count} fotos' },
    livePhotos: { one: '{count} Live', other: '{count} Live' },
    videos: { zero: 'Sem vídeos', one: '{count} vídeo', other: '{count} vídeos' },
    children: { zero: 'Sem crianças', one: '{count} criança', other: '{count} crianças' },
    categories: { zero: 'Sem categorias', one: '{count} categoria', other: '{count} categorias' },
    users: { one: '{count} utilizador', other: '{count} utilizadores' },
    admins: { one: '{count} administrador', other: '{count} administradores' },
    yearColors: { one: '{count} cor de ano', other: '{count} cores de ano' },
    background: 'Imagem de fundo',
  },
  export: {
    title: 'Exportar',
    description:
      'Um ficheiro ZIP com tudo: os marcos (incluindo os do lixo) com as suas fotos e vídeos originais, as crianças, as categorias, os utilizadores e a aparência. Ao abri-lo, verás as fotos organizadas por ano e por marco.',
    contents: 'Conteúdo da cópia',
    action: 'Transferir cópia',
    note: 'A transferência começa de imediato e, com muitos vídeos, pode demorar. As sessões não são copiadas: cada pessoa volta a entrar com a sua conta Google.',
    loadError: 'Não foi possível calcular o conteúdo da cópia.',
  },
  import: {
    title: 'Importar',
    description:
      'Restaura uma cópia do Timelife (o ficheiro ZIP que transferes acima), mesmo que venha de outro servidor. O ficheiro é carregado por partes: se a ligação cair, volta a escolhê-lo e o carregamento continua onde parou.',
    choose: 'Escolher ficheiro ZIP',
    loadError: 'Não foi possível consultar a importação.',
    uploading: 'A carregar «{name}»',
    uploaded: '{sent} de {size}',
    cancelUpload: 'Cancelar carregamento',
    resume: {
      title: 'Carregamento a meio',
      description: '«{name}» ficou a meio ({received} de {size}). Escolhe o mesmo ficheiro para continuar onde parou.',
      action: 'Continuar com o mesmo ficheiro',
    },
    otherFile: 'Esse não é o ficheiro que estava a ser carregado. Escolhe «{name}» ou descarta o carregamento.',
    discard: 'Descartar',
    invalid: 'Não é possível importar «{name}»',
    archive: {
      title: 'Cópia de {date}',
      version: 'Feita com o Timelife {version}',
      contents: 'Conteúdo do ficheiro',
      missing: {
        one: 'Falta {count} ficheiro de foto ou vídeo na cópia: não será importado.',
        other: 'Faltam {count} ficheiros de fotos ou vídeos na cópia: não serão importados.',
      },
    },
    previousError: 'A última importação não terminou: {reason} Nada foi alterado; podes voltar a tentar.',
    mode: {
      label: 'Como queres importá-la?',
      merge: {
        title: 'Fundir',
        description:
          'Adiciona o que falta e não altera nem apaga nada do que já existe. Um marco já existe se a data, o título e as crianças coincidirem, mesmo que esteja no lixo.',
      },
      replace: {
        title: 'Substituir tudo',
        description:
          'Apaga tudo o que existe agora (marcos, fotos e vídeos, crianças, categorias, utilizadores e aparência) e deixa a cópia tal como está, com as mesmas ligações. Tu continuas a ser administrador.',
      },
    },
    start: 'Importar',
    confirm: {
      title: 'Substituir tudo?',
      message:
        'Tudo o que existe agora no Timelife será apagado e substituído pela cópia de {date}. Não é possível anular: se tiveres dúvidas, transfere primeiro uma cópia.',
      action: 'Substituir tudo',
    },
    running: {
      media: 'A processar fotos e vídeos…',
      saving: 'A guardar as alterações…',
      progress: '{done} de {total}',
      note: 'Podes sair desta página: a importação continua no servidor.',
    },
    cancel: 'Cancelar importação',
  },
  report: {
    title: 'Importação concluída',
    mode: {
      merge: 'A cópia foi fundida com o que já existia.',
      replace: 'Tudo foi substituído pela cópia.',
    },
    caption: 'Resultado da importação',
    columns: { item: 'Elemento', created: 'Novos', skipped: 'Já existiam', failed: 'Com erro' },
    rows: {
      events: 'Marcos',
      media: 'Fotos, vídeos, avatares e fundo',
      children: 'Crianças',
      categories: 'Categorias',
      users: 'Utilizadores',
      year_colors: 'Cores de ano',
    },
    issues: 'Elementos com problemas',
    issue: '{kind} «{name}»: {reason}',
    kinds: {
      user: 'Utilizador',
      category: 'Categoria',
      child: 'Criança',
      event: 'Marco',
      media: 'Foto ou vídeo',
      year_color: 'Cor de ano',
      settings: 'Definições',
    },
    more: { one: 'E mais {count}.', other: 'E mais {count}.' },
    videos: 'Os vídeos estão a ser convertidos em segundo plano: durante algum tempo, vão mostrar «A processar…».',
    close: 'Fechar',
  },
}
