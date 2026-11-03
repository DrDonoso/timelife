// Namespace owned by frontend-timeline: the interactive milestones timeline (spec 40).
// The English file mirrors these keys (type-checked).
export const timeline = {
  regionLabel: 'Línea de tiempo de {name}',
  family: {
    name: 'Todos juntos',
    regionLabel: 'Línea de tiempo de todos juntos',
    empty: 'Todavía no hay hitos',
  },
  listLabel: {
    years: { one: 'Años con hitos: {count} año', other: 'Años con hitos: {count} años' },
    months: { one: 'Meses con hitos: {count} mes', other: 'Meses con hitos: {count} meses' },
    events: { one: '{count} hito', other: '{count} hitos' },
  },
  levels: {
    years: 'Años',
    months: 'Meses',
    events: 'Días',
  },
  levelView: {
    years: 'Vista por años',
    months: 'Vista por meses',
    events: 'Vista por días',
  },
  zoom: {
    group: 'Zoom de la línea de tiempo',
    level: 'Nivel de detalle',
    in: 'Acercar',
    out: 'Alejar',
    inShortcut: 'Acercar (+)',
    outShortcut: 'Alejar (−)',
  },
  count: { zero: 'Sin hitos', one: '{count} hito', other: '{count} hitos' },
  hubLabel: { one: '{period} · {count} hito', other: '{period} · {count} hitos' },
  eventLabel: '{title} · {date}',
  eventLabelWithCategories: '{title} · {date} · {categories}',
  eventLabelPeople: '{label} · {people}',
  announce: {
    one: '{level} · {count} elemento',
    other: '{level} · {count} elementos',
  },
  hint: 'Ctrl + rueda o pellizca para cambiar el zoom',
  loading: 'Cargando la línea de tiempo…',
  empty: {
    title: 'Todavía no hay hitos de {name}',
    descriptionAdmin: 'Añade el primero y empieza a construir su línea de tiempo.',
    descriptionViewer: 'Cuando se añadan hitos, aparecerán aquí.',
    action: 'Añadir el primer hito',
  },
  noResults: {
    title: 'Ningún hito coincide con la búsqueda',
    description: 'Prueba con otras palabras, otras fechas u otras categorías.',
    action: 'Limpiar filtros',
  },
  error: {
    title: 'No se ha podido cargar la línea de tiempo',
    retry: 'Reintentar',
  },
  create: {
    action: 'Nuevo hito',
    title: 'Nuevo hito',
  },
} as const
