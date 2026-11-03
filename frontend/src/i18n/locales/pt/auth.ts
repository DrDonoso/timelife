import type { Messages } from '../../types'
import type { auth as source } from '../es/auth'

export const auth: Messages<typeof source> = {
  continueWithGoogle: 'Continuar com o Google',
  redirecting: 'A abrir o Google…',
  inviteOnly: 'O Timelife é privado: só entram as pessoas a quem um administrador deu acesso.',
  configError: 'Não foi possível carregar a configuração de acesso.',
  checkingSession: 'A verificar a tua sessão…',
  sessionError: 'Não foi possível verificar a tua sessão.',
  signIn: {
    title: 'Entrar com o teu e-mail',
    email: 'E-mail',
    emailPlaceholder: 'nome@exemplo.com',
    password: 'Palavra-passe',
    submit: 'Entrar',
    forgot: 'Esqueceste-te da palavra-passe?',
  },
  firstPassword: {
    title: 'Escolhe a tua palavra-passe',
    description:
      'A tua palavra-passe é temporária: foi-te dada por um administrador. Escolhe uma nova, que só tu saibas, para entrar.',
    account: 'Conta',
    submit: 'Guardar e entrar',
    back: 'Voltar',
  },
  forgot: {
    title: 'Recupera a tua palavra-passe',
    description: 'Escreve o e-mail com que entras e vamos enviar-te uma ligação para escolheres uma palavra-passe nova.',
    submit: 'Enviar a ligação',
    sent: 'Se {email} tiver acesso ao Timelife, vais receber um e-mail com uma ligação para escolheres uma palavra-passe nova. A ligação expira dentro de uma hora: procura também na pasta de spam.',
    back: 'Voltar ao início de sessão',
  },
  reset: {
    title: 'Escolhe uma palavra-passe nova',
    description: 'Ao guardá-la, entras no Timelife e a sessão é terminada nos teus outros dispositivos.',
    submit: 'Guardar e entrar',
    invalidLink: 'Esta ligação não é válida: pode estar incompleta. Pede outra em «Esqueceste-te da palavra-passe?».',
    expired: 'Esta ligação expirou ou já foi utilizada. Pede outra em «Esqueceste-te da palavra-passe?».',
    toLogin: 'Ir para o início de sessão',
  },
  setup: {
    title: 'Cria a conta de administração',
    description:
      'O Timelife ainda não tem administrador. Quem criar esta conta poderá gerir tudo: crianças, marcos, fotos e quem entra.',
    recoveryTitle: 'Recupera a administração',
    recoveryDescription:
      'Cria uma conta de administração ou, se o e-mail já tiver conta, escolhe a nova palavra-passe dessa conta: passará a ter permissões de administração.',
    email: 'E-mail',
    name: 'O teu nome',
    nameDescription: 'Opcional: é assim que os outros te vão ver no Timelife.',
    submit: 'Criar e entrar',
    recoverySubmit: 'Guardar e entrar',
    footnote: 'Depois, em Administração → Utilizadores, podes dar acesso à tua família.',
    invalidLink:
      'Esta ligação de recuperação não é válida ou está incompleta. Gera outra com o comando de recuperação do servidor.',
    closed: 'Esta ligação já não serve: expirou ou já foi utilizada. Gera outra com o comando de recuperação do servidor.',
    toLogin: 'Ir para o início de sessão',
  },
  newPassword: {
    label: 'Palavra-passe nova',
    repeat: 'Repete a palavra-passe',
    description: 'Pelo menos 8 caracteres. De preferência, uma frase fácil de recordar para ti e difícil de adivinhar.',
  },
  rules: {
    emailRequired: 'Escreve o teu e-mail.',
    emailInvalid: 'Escreve um e-mail válido, por exemplo nome@exemplo.com.',
    required: 'Escreve a palavra-passe.',
    tooShort: 'Tem de ter pelo menos 8 caracteres.',
    tooLong: 'Pode ter, no máximo, 200 caracteres.',
    invalid: 'Não pode estar em branco nem conter tabulações ou quebras de linha.',
    mismatch: 'As duas palavras-passe não coincidem.',
    unchanged: 'Escolhe uma palavra-passe diferente da atual.',
  },
  change: {
    menu: 'Alterar palavra-passe',
    title: 'Alterar a tua palavra-passe',
    description: 'A sessão vai ser terminada nos teus outros dispositivos; neste, continuas com a sessão iniciada.',
    current: 'Palavra-passe atual',
    submit: 'Alterar palavra-passe',
    done: 'Palavra-passe alterada. A sessão foi terminada nos teus outros dispositivos.',
  },
  devLogin: {
    title: 'Acesso de desenvolvimento',
    description: 'Só está disponível localmente.',
    user: 'Utilizador',
    admin: 'Administrador',
    viewer: 'Leitor',
    password: 'Palavra-passe',
    submit: 'Entrar',
  },
  or: 'ou',
}
