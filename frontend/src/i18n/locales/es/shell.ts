export const shell = {
  skipToContent: 'Saltar al contenido',
  home: 'Timelife, inicio',
  childSwitcher: {
    label: 'Cambiar de niño',
    current: 'Viendo a {name}',
    all: 'Todos juntos',
    allDescription: 'Cada niño en su línea',
  },
  search: {
    open: 'Buscar',
    close: 'Cerrar búsqueda',
  },
  themeMenu: 'Tema: {palette} · Modo: {mode}',
  languageMenu: 'Idioma: {language}',
  userMenu: {
    label: 'Menú de usuario',
    admin: 'Administración',
    timeline: 'Línea de tiempo',
    signOut: 'Cerrar sesión',
  },
  notifications: 'Notificaciones',
  noChildren: {
    title: 'Todavía no hay niños',
    descriptionAdmin: 'Añade al primer niño para empezar a guardar sus hitos.',
    descriptionViewer: 'Cuando un administrador añada a los niños, aquí verás sus hitos.',
    action: 'Añadir niños',
  },
  childNotFound: {
    title: 'No encontramos a este niño',
    description: 'Puede que el enlace haya cambiado o que ya no exista.',
    action: 'Ver la línea de tiempo',
  },
  childrenError: 'No se han podido cargar los niños.',
} as const
