export const admin = {
  title: 'Administración',
  nav: {
    label: 'Secciones',
    events: 'Eventos',
    categories: 'Categorías',
    children: 'Niños',
    appearance: 'Colores y apariencia',
    users: 'Usuarios',
    trash: 'Papelera',
    backup: 'Importar y exportar',
  },
  backToTimeline: 'Volver a la línea de tiempo',
  openMenu: 'Abrir menú de administración',
  closeMenu: 'Cerrar menú',
  version: 'Versión {version}',
  versionWithDate: 'Versión {version} · {date}',
  /** Closing a settings form (Esc, backdrop, ×, Cancelar) with unsaved changes. */
  discardChanges: {
    title: '¿Descartar los cambios?',
    message: 'Tienes cambios sin guardar. Si cierras ahora, se perderán.',
    confirm: 'Descartar cambios',
    stay: 'Seguir editando',
  },
  notFound: {
    title: 'Sección no encontrada',
    description: 'Esta página de administración no existe.',
    action: 'Ir a eventos',
  },
} as const
