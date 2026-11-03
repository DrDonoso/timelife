export const components = {
  modal: {
    close: 'Cerrar',
  },
  spinner: {
    label: 'Cargando',
  },
  toast: {
    dismiss: 'Cerrar notificación',
  },
  select: {
    placeholder: 'Selecciona una opción',
  },
  textArea: {
    counter: '{count} / {max}',
  },
  passwordField: {
    show: 'Mostrar contraseña',
    hide: 'Ocultar contraseña',
  },
  colorInput: {
    open: 'Elegir color',
    hex: 'Código del color',
    hue: 'Tono',
    area: 'Saturación y brillo',
    presets: 'Colores sugeridos',
    invalid: 'Escribe un color hexadecimal, por ejemplo #3b82f6.',
  },
  iconPicker: {
    search: 'Buscar icono',
    results: { zero: 'Ningún icono', one: '{count} icono', other: '{count} iconos' },
    noResults: 'Ningún icono coincide con «{query}».',
  },
  dateField: {
    openCalendar: 'Abrir calendario',
    previousMonth: 'Mes anterior',
    nextMonth: 'Mes siguiente',
    today: 'Hoy',
    clear: 'Borrar fecha',
  },
  chipMultiSelect: {
    selected: 'Seleccionados',
    available: 'Disponibles',
    noneSelected: 'Nada seleccionado todavía.',
    primary: 'Principal',
    orderHint: 'El orden importa: el primero es el principal.',
    moveEarlier: 'Mover {label} antes',
    moveLater: 'Mover {label} después',
    remove: 'Quitar {label}',
    add: 'Añadir {label}',
  },
  categoryBadges: {
    more: { one: '{count} categoría más', other: '{count} categorías más' },
  },
  avatarGroup: {
    more: { one: '{count} más', other: '{count} más' },
  },
} as const
