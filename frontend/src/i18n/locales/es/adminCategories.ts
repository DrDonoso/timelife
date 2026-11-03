// Namespace owned by frontend-admin-settings (Admin → Categorías).
export const adminCategories = {
  description:
    'Agrupan los hitos por tipo. Su color y su icono se ven en la línea de tiempo, y su orden es el de los filtros y los selectores.',
  new: 'Nueva categoría',
  listLabel: 'Categorías (arrastra para ordenar)',
  count: { one: '{count} categoría', other: '{count} categorías' },
  loadError: 'No se han podido cargar las categorías.',
  empty: {
    title: 'Todavía no hay categorías',
    description: 'Crea la primera para clasificar los hitos, por ejemplo «Primeras palabras» o «Sueño».',
  },
  reorder: {
    hint: 'Arrastra las filas o usa las flechas para cambiar el orden. Se guarda automáticamente.',
    saving: 'Guardando el orden…',
    saved: 'Orden guardado',
    moved: '{name}: posición {position} de {total}.',
  },
  row: {
    drag: 'Arrastrar {name} para cambiar el orden',
    moveUp: 'Subir {name}',
    moveDown: 'Bajar {name}',
    edit: 'Editar {name}',
    delete: 'Eliminar {name}',
    color: 'Color',
    icon: 'Icono',
  },
  form: {
    createTitle: 'Nueva categoría',
    editTitle: 'Editar categoría',
    nameEs: 'Nombre en español',
    nameEn: 'Nombre en inglés',
    namePt: 'Nombre en portugués',
    nameEsPlaceholder: 'Por ejemplo, Primeras palabras',
    nameEnPlaceholder: 'For example, First words',
    namePtPlaceholder: 'Por exemplo, Primeiras palavras',
    nameEsRequired: 'Escribe el nombre en español.',
    nameEnRequired: 'Escribe el nombre en inglés.',
    namePtRequired: 'Escribe el nombre en portugués.',
    tooLong: 'Como máximo {max} caracteres.',
    color: 'Color',
    colorDescription: 'Elige uno de los sugeridos o cualquier otro.',
    colorInvalid: 'Escribe un color hexadecimal, por ejemplo #3b82f6.',
    icon: 'Icono',
    iconRequired: 'Elige un icono.',
    create: 'Crear categoría',
    save: 'Guardar cambios',
  },
  preview: {
    title: 'Vista previa',
    light: 'Modo claro',
    dark: 'Modo oscuro',
    sampleTitle: 'Primer hito',
    placeholderName: 'Nueva categoría',
    contrastNote:
      'Para que el texto blanco se lea bien, las píldoras y las insignias usan un tono algo más intenso de este color.',
  },
  delete: {
    title: '¿Eliminar «{name}»?',
    message:
      'Solo se puede eliminar si ningún hito la usa, tampoco los que están en la papelera. Esta acción no se puede deshacer.',
    confirm: 'Eliminar categoría',
  },
  toast: {
    created: 'Categoría «{name}» creada.',
    updated: 'Categoría «{name}» guardada.',
    deleted: 'Categoría «{name}» eliminada.',
  },
} as const
