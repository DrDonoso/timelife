// Memories ("on this day"): the header button, its panel and the notice telling about them.
export const memories = {
  button: {
    label: 'Recuerdos',
    unseen: { one: 'Recuerdos ({count} nuevo hoy)', other: 'Recuerdos ({count} nuevos hoy)' },
  },
  title: 'Recuerdos de hoy',
  loading: 'Buscando recuerdos…',
  error: 'No se han podido cargar los recuerdos.',
  /** How long ago it happened, in lower case inside a sentence (capitalised as a heading). */
  ago: {
    months: { one: 'hace {count} mes', other: 'hace {count} meses' },
    years: { one: 'hace {count} año', other: 'hace {count} años' },
  },
  empty: 'Hoy no hay recuerdos.',
  next: { one: 'El próximo, el {date}:', other: 'Los próximos, el {date}:' },
  nextMore: 'Y {count} más ese día.',
  none: 'Cuando los hitos cumplan meses o años, los verás aquí.',
  toast: {
    single: 'Tal día como hoy, {ago}: «{title}».',
    several: {
      one: 'Tal día como hoy, {ago}: «{title}» y {count} recuerdo más.',
      other: 'Tal día como hoy, {ago}: «{title}» y {count} recuerdos más.',
    },
    action: 'Ver',
  },
} as const
