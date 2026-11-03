import type { Messages } from '../../types'
import type { adminUsers as source } from '../es/adminUsers'

// Namespace owned by frontend-admin-settings (Admin → Utilizadores).
export const adminUsers: Messages<typeof source> = {
  description: 'Quem pode entrar no Timelife e com que permissões.',
  count: { one: '{count} pessoa', other: '{count} pessoas' },
  loadError: 'Não foi possível carregar os utilizadores.',
  invite: {
    title: 'Dar acesso a alguém',
    explanation:
      'O Timelife é privado: só entram as pessoas que adicionares aqui. Define uma palavra-passe temporária e partilha-a com a pessoa, juntamente com o e-mail: vai alterá-la da primeira vez que entrar.',
    explanationGoogle:
      'O Timelife é privado: só entram as pessoas que adicionares aqui. Vão entrar através de «Continuar com o Google» com este e-mail ou, se lhes atribuíres uma palavra-passe temporária, com o e-mail e essa palavra-passe (vão alterá-la ao entrar).',
    email: 'E-mail',
    emailPlaceholder: 'nome@exemplo.com',
    name: 'Nome',
    nameDescription: 'Opcional.',
    role: 'Função',
    password: 'Palavra-passe temporária',
    passwordDescription: 'Pelo menos 8 caracteres. Vai alterá-la da primeira vez que entrar.',
    passwordDescriptionGoogle: 'Opcional: sem ela, só poderá entrar com o Google. Vai alterá-la da primeira vez que entrar.',
    generate: 'Gerar',
    generateLabel: 'Gerar uma palavra-passe temporária',
    submit: 'Adicionar',
    required: 'Escreve o e-mail da pessoa.',
    invalidEmail: 'Escreve um e-mail válido, por exemplo nome@exemplo.com.',
    exists: 'Este e-mail já tem acesso.',
    success: 'Feito: {email} já pode entrar com o e-mail e a palavra-passe temporária.',
    successGoogle: 'Feito: {email} já pode entrar com o Google.',
  },
  roles: {
    viewer: 'Vê as linhas do tempo e as fotos',
    admin: 'Também adiciona e edita marcos, fotos, crianças, aparência e utilizadores',
  },
  notes: {
    roles: 'Os leitores só veem as linhas do tempo e as fotos; os administradores também podem alterar tudo e carregar fotos e vídeos.',
    sessions:
      'Alterar a função de alguém, desativar a sua conta ou repor a sua palavra-passe termina a sessão dessa pessoa em todos os dispositivos.',
  },
  table: {
    caption: 'Utilizadores com acesso ao Timelife',
    user: 'Pessoa',
    role: 'Função',
    enabled: 'Ativo',
    access: 'Acesso',
    lastLogin: 'Último acesso',
    actions: 'Ações',
  },
  you: 'Tu',
  disabledBadge: 'Desativado',
  password: {
    set: 'Palavra-passe',
    setHint: 'Entra com o e-mail e a palavra-passe.',
    temporary: 'Palavra-passe temporária',
    temporaryHint: 'Tem de a alterar da próxima vez que entrar.',
    none: 'Sem palavra-passe',
    noneHint: 'Não pode entrar até lhe atribuíres uma palavra-passe.',
    noneHintGoogle: 'Entra só com o Google.',
  },
  google: {
    linked: 'Google',
    linkedHint: 'Já entrou com o Google.',
    pending: 'Google pendente',
    pendingHint: 'Ainda não entrou com o Google.',
  },
  never: 'Nunca',
  roleLabel: 'Função de {email}',
  enabledLabel: 'Acesso ativo de {email}',
  delete: 'Eliminar {email}',
  resetPassword: 'Repor a palavra-passe de {email}',
  setPassword: 'Atribuir uma palavra-passe a {email}',
  lock: {
    self: 'Não podes alterar a tua própria função, desativar-te nem eliminar-te. A tua palavra-passe podes alterá-la no teu menu.',
  },
  confirmDelete: {
    title: 'Eliminar {email}?',
    message: 'Vai perder o acesso de imediato e a sessão será terminada. Podes voltar a dar-lhe acesso quando quiseres.',
    confirm: 'Eliminar acesso',
  },
  passwordDialog: {
    title: 'Palavra-passe temporária de {email}',
    description:
      'Escreve ou gera uma palavra-passe temporária e partilha-a com a pessoa: terá de a alterar da primeira vez que entrar. A sessão dessa pessoa será terminada em todos os dispositivos.',
    submit: 'Guardar palavra-passe',
  },
  toast: {
    role: 'Função de {email} alterada para {role}.',
    enabled: '{email} volta a ter acesso.',
    disabled: '{email} já não pode entrar.',
    deleted: '{email} já não tem acesso.',
    password: 'Palavra-passe temporária de {email} guardada: vai alterá-la ao entrar.',
  },
}
