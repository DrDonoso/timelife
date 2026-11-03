// Namespace of the import & export page (`/admin/backup`). English mirrors these keys.
export const adminBackup = {
  description: 'Descarga una copia completa de Timelife o restaura una copia en este servidor.',
  size: '≈ {size}',
  summary: {
    events: { zero: 'Sin hitos', one: '{count} hito', other: '{count} hitos' },
    trashed: { one: '{count} en la papelera', other: '{count} en la papelera' },
    photos: { zero: 'Sin fotos', one: '{count} foto', other: '{count} fotos' },
    livePhotos: { one: '{count} Live', other: '{count} Live' },
    videos: { zero: 'Sin vídeos', one: '{count} vídeo', other: '{count} vídeos' },
    children: { zero: 'Sin niños', one: '{count} niño', other: '{count} niños' },
    categories: { zero: 'Sin categorías', one: '{count} categoría', other: '{count} categorías' },
    users: { one: '{count} usuario', other: '{count} usuarios' },
    admins: { one: '{count} administrador', other: '{count} administradores' },
    yearColors: { one: '{count} color de año', other: '{count} colores de año' },
    background: 'Imagen de fondo',
  },
  export: {
    title: 'Exportar',
    description:
      'Un archivo ZIP con todo: los hitos (también los de la papelera) con sus fotos y vídeos originales, los niños, las categorías, los usuarios y la apariencia. Al abrirlo verás las fotos ordenadas por año e hito.',
    contents: 'Contenido de la copia',
    action: 'Descargar copia',
    note: 'La descarga empieza enseguida y, con muchos vídeos, puede tardar. Las sesiones no se copian: cada persona vuelve a entrar con su cuenta de Google.',
    loadError: 'No se ha podido calcular el contenido de la copia.',
  },
  import: {
    title: 'Importar',
    description:
      'Restaura una copia de Timelife (el archivo ZIP que descargas arriba), también de otro servidor. El archivo se sube por partes: si se corta la conexión, vuelve a elegirlo y seguirá donde se quedó.',
    choose: 'Elegir archivo ZIP',
    loadError: 'No se ha podido consultar la importación.',
    uploading: 'Subiendo «{name}»',
    uploaded: '{sent} de {size}',
    cancelUpload: 'Cancelar subida',
    resume: {
      title: 'Subida a medias',
      description: '«{name}» se quedó a medias ({received} de {size}). Elige el mismo archivo para seguir donde se quedó.',
      action: 'Continuar con el mismo archivo',
    },
    otherFile: 'Ese no es el archivo que se estaba subiendo. Elige «{name}» o descarta la subida.',
    discard: 'Descartar',
    invalid: 'No se puede importar «{name}»',
    archive: {
      title: 'Copia del {date}',
      version: 'Hecha con Timelife {version}',
      contents: 'Contenido del archivo',
      missing: {
        one: 'Falta {count} archivo de foto o vídeo en la copia: esa foto o vídeo no se importará.',
        other: 'Faltan {count} archivos de fotos o vídeos en la copia: no se importarán.',
      },
    },
    previousError: 'La última importación no terminó: {reason} No se ha cambiado nada; puedes volver a intentarlo.',
    mode: {
      label: '¿Cómo quieres importarla?',
      merge: {
        title: 'Fusionar',
        description:
          'Añade lo que falta y no cambia ni borra nada de lo que ya hay. Un hito ya existe si coinciden la fecha, el título y los niños, aunque esté en la papelera.',
      },
      replace: {
        title: 'Reemplazar todo',
        description:
          'Borra todo lo actual (hitos, fotos y vídeos, niños, categorías, usuarios y apariencia) y deja la copia tal cual, con los mismos enlaces. Tú sigues siendo administrador.',
      },
    },
    start: 'Importar',
    confirm: {
      title: '¿Reemplazar todo?',
      message:
        'Se borrará todo lo que hay ahora en Timelife y se sustituirá por la copia del {date}. No se puede deshacer: si tienes dudas, descarga antes una copia.',
      action: 'Reemplazar todo',
    },
    running: {
      media: 'Procesando fotos y vídeos…',
      saving: 'Guardando los cambios…',
      progress: '{done} de {total}',
      note: 'Puedes salir de esta página: la importación sigue en el servidor.',
    },
    cancel: 'Cancelar importación',
  },
  report: {
    title: 'Importación terminada',
    mode: {
      merge: 'Se ha fusionado la copia con lo que ya había.',
      replace: 'Se ha reemplazado todo por la copia.',
    },
    caption: 'Resultado de la importación',
    columns: { item: 'Elemento', created: 'Nuevos', skipped: 'Ya estaban', failed: 'Con error' },
    rows: {
      events: 'Hitos',
      media: 'Fotos, vídeos, avatares y fondo',
      children: 'Niños',
      categories: 'Categorías',
      users: 'Usuarios',
      year_colors: 'Colores de año',
    },
    issues: 'Elementos con problemas',
    issue: '{kind} «{name}»: {reason}',
    kinds: {
      user: 'Usuario',
      category: 'Categoría',
      child: 'Niño',
      event: 'Hito',
      media: 'Foto o vídeo',
      year_color: 'Color de año',
      settings: 'Ajustes',
    },
    more: { one: 'Y {count} más.', other: 'Y {count} más.' },
    videos: 'Los vídeos se están convirtiendo en segundo plano: verás «Procesando…» en ellos durante un rato.',
    close: 'Cerrar',
  },
} as const
