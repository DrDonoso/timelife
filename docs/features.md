# Features

Everything Timelife does, in detail. The [README](../README.md#features) has the short version, and the
[demo](https://demo.timelife.lauvid.com) lets you try it all with sample data.

- [Timeline](#timeline)
- [Search and filters](#search-and-filters)
- [Memories](#memories)
- [Notifications](#notifications)
- [Event details](#event-details)
- [Administration](#administration)
- [Everywhere](#everywhere)
- [Privacy and security](#privacy-and-security)

## Timeline

- One timeline per child, newest first, plus **Todos juntos** (*All together*, `/all`) with every child at once. The
  line runs in the direction the administrators choose for computers and for phones — by default horizontal with the
  newest milestone on the left on desktop and tablet, vertical with the newest at the top on phones — and always
  rests on the newest milestone. A child switcher in the header remembers your last choice (the family view too).
- **Todos juntos**: at the days level each child has their own line, in their own colour (the theme's automatic one, or
  the one an administrator chose), starting at their avatar; the milestones they share sit between those lines, which
  curve into them side by side. Years and months show everyone's milestones on a single line. Nodes and cards say
  whose each milestone is.
- The first time the app is opened in a browser session the line sweeps from the oldest milestone to the newest,
  lighting them up on the way (skipped with `prefers-reduced-motion`, with a link to a specific milestone, or at the
  first touch, scroll or key).
- Three zoom levels — years (*Años*), months (*Meses*) and events (*Días*) — with Ctrl/⌘ + mouse wheel, trackpad or
  touch pinch, the floating zoom control, the `+`/`-` keys, or by clicking a year/month hub. Zooming in bursts the
  children out of their parent hub; zooming out merges them back (reduced to a cross-fade with
  `prefers-reduced-motion`).
- Each event is a circle with its cover photo, a ring in the colour of its categories (split into arcs when it has
  several), the title above, category badges and the date. Year and month hubs show the year or the month's first
  three letters (*ENE*, *FEB*… / *JAN*, *FEB*… / *JAN*, *FEV*…) and how many milestones they hold, and grow with that
  number (the busiest hub of the view is the largest); every year has its own colour (the theme's automatic one, or
  one an admin chose) and its months share that palette.
- An event can belong to several children (siblings sharing a milestone) and to several categories. Events of the same
  day appear in the order the administrators choose (newly added ones first).
- Administrators add milestones straight from the timeline: the floating **Nuevo hito** button opens the editor over
  the timeline with the current child chosen (none on *Todos juntos*), and the new milestone is then shown (days
  level, with a pulse).

## Search and filters

- Search bar (`/` shortcut) with accent- and case-insensitive title search and instant suggestions that jump straight
  to the event.
- Filter panel: date range (with presets such as *this year* or *last 12 months*) and categories. Hub counts follow
  the filters.

## Memories

- **Recuerdos** (*Memories*, "on this day"): every day, the milestones of the whole family that turn a whole number of
  months (1 to 11) or of years old that day: the same day of the month, or the last day of shorter months for those of
  the 29th to the 31st (29 February: the 28th in other years).
- The first time someone opens a timeline that day, on any of their devices, a notice tells them, with the first
  one's photo: *Tal día como hoy, hace 1 año: «Primeros pasos»*. **Ver** opens that milestone over its timeline (or the
  list, when there are several). It waits until *Novedades* has been read and no milestone is open.
- The clock button in the header shows how many of today's memories have not been looked at yet and opens their
  list, by age (*Hace 1 mes*, *Hace 1 año*…), each with its photo, date and children: choosing one opens it over the
  timeline on screen when it is there, or over its child's, and the line moves to it. Looking at them counts them as
  seen, on every device. On a day without memories it says which day brings the next ones.
- With [notifications](#notifications) on, they also arrive at 9:00.

## Notifications

- **Activar notificaciones** (*Turn on notifications*, in the account menu) turns on that device's notifications, in
  its own language:
  - **Recuerdos del día** (*Today's memories*): a notification at 9:00 of the device's time zone on the days with
    memories: *Recuerdos de hoy — Tal día como hoy, hace 1 año: «Primeros pasos».* Tapping it opens that milestone, or
    the list when there are several, and the app's icon shows how many are left to see. It counts as the day's notice
    (the app does not tell them again), and it is not sent when they were already looked at or told that day; every
    device of a person that is due at that time gets it. A server that was down at nine sends it when it is back,
    until 21:00, never later.
  - **Cumpleaños** (*Birthdays*): at the same time, on the day a child turns a year older and, during their first
    year, every month: *Lucía cumple 4 años — Hoy es su cumpleaños.*, *Leo cumple 7 meses — Hoy hace 7 meses que
    nació.* Those born on the 29th to the 31st have theirs on the last day of shorter months, as the
    [memories](#memories). One notification per child, once a day on each device; tapping it opens the child's
    timeline. Only children with a birth date have them.
  - **Hitos nuevos** (*New milestones*): when someone adds a milestone, everybody else is told within a minute, at any
    time of day: *Nuevo hito de Lucía y Leo — Ana ha añadido «Primeros pasos».* Tapping it opens the milestone. One
    notification per milestone; editing one tells nobody, and neither does one moved to the trash before it went out
    nor the milestones of an import. A device that cannot be reached gets it when it is back, within a day.
- **Elegir notificaciones** (*Choose notifications*), under the switch once they are on, chooses which of them arrive.
  It is each person's choice, for all their devices, and saved at once; everybody gets all of them until they choose.
- **iPhone and iPad** (iOS/iPadOS 16.4 or later): only the app added to the Home Screen gets notifications; in Safari
  the account menu explains how to add it. The first time the installed app opens, it offers to turn them on.
- **Android and computers**: Chrome, Edge, Firefox and Safari on the Mac, installed or not.
- Signing out stops them on that device; a new password, a new role or a disabled account stops them on every device
  until it signs in again.

## Event details

- A large card (full screen on phones) with a carousel of the photos and videos (cover first), category pills, date,
  location, notes and the children involved. Videos play in the browser's own player (sound, seeking, full screen) and
  pause when you move to another item. Live Photos show a **LIVE** badge: they move once, with sound when the browser
  allows it, each time they appear (not with `prefers-reduced-motion`), and again when you hover over the badge, press
  it or hold the photo down. Photos and videos show no file names (only their alternative text). On phones, pulling
  the card down from its top closes it like its close button, and tapping a photo opens the carousel full screen to
  swipe through the rest; swiping the photo down (it follows the finger and uncovers the card), ✕ or the Back button
  leave full screen. Admins can edit the event in place.

## Administration

Under `/admin`, for administrators only.

- **Eventos** — create, edit and delete events; search them and filter by child, category and date range (with the
  same presets as the timeline); drag-and-drop upload of photos (JPEG, PNG, WebP, HEIC/HEIF, GIF) and videos (MP4,
  MOV, WebM, MKV, AVI, MTS…) with progress, reordering, renaming and cover selection, and a live preview of the
  timeline circle. *Ajustar encuadre* zooms and moves the cover inside that circle (a video's cover is a frame near
  its start). Events of the same day are grouped in the list: drag them (or use the arrows) to choose which one comes
  first on the timeline. While typing a location, the places other milestones already use are suggested (any word,
  accents and case ignored; the most used first).
- **Videos** are converted on the server after the upload (the card shows *Procesando…* with its progress; the event
  can be saved meanwhile) into an MP4 every browser plays: H.264/AAC, at most 1920 px on the long edge and 60 fps, HDR
  (iPhone HLG/Dolby Vision) mapped to SDR. Up to `MAX_VIDEO_UPLOAD_MB` (500 MB) and `MAX_VIDEO_MINUTES` (10 min) each.
- **Live Photos** (iPhone): select the photo and its video together — they have the same name, e.g.
  `IMG_1234.HEIC` + `IMG_1234.MOV` — or upload the `.livp` file iCloud.com downloads; the uploader pairs them into one
  item with a **LIVE** switch (on by default, also later in the editor) that shows it with or without motion. iOS keeps
  the two halves as separate files and Safari on the iPhone (or the installed app) only uploads the still, so the clip
  has to come from a computer: copy the photos from the iPhone, export them from Photos on a Mac (*Export Unmodified
  Original*) or download them from iCloud.com.
- **Categorías** — Spanish, English and Portuguese names, colour, icon and order. Eleven defaults are created on first
  start: General, Académico, Dentición, Lenguaje y comunicación, Sueño, Motricidad gruesa, Motricidad fina, Desarrollo
  cognitivo, Desarrollo social y emocional, Alimentación, Autonomía y cuidado personal.
- **Niños** — name, birth date (it brings the [birthday notifications](#notifications)), avatar and order. The
  address of a child's timeline (`/c/<name>`) is made from the name when the child is added and never changes
  afterwards, not even after a rename, so saved links keep working.
- **Colores y apariencia** — the years that should not use their automatic colour (add a year, pick its colour and
  its months follow; removing it brings the automatic colour back), the colour of each child's line on *Todos juntos*
  (automatic or chosen), background image and opacity, default zoom level, and which way time runs along the timeline
  on computers and on phones (left → right, right → left, top → bottom or bottom → top). Chosen colours keep their hue
  in every theme, which only adjusts their lightness so they read well on its background.
- **Usuarios** — give people access with their e-mail, a role (*viewer* or *admin*) and a temporary password (typed or
  generated) that they replace with their own at their first sign-in; with Google sign-in configured the password is
  optional. Reset someone's password (they choose a new one at their next sign-in), change roles, disable or remove
  access.
- **Papelera** — deleted events stay in the trash until they are restored or deleted permanently.
- **Importar y exportar** — **export** downloads one ZIP with everything: users, categories, children with their
  avatars and line colours, every milestone (the trash too) with its **original** photos, videos and Live Photo clips,
  year colours and appearance settings. Inside, the photos are in folders by year and milestone
  (`events/2025/2025-03-22 Primeros pasos/IMG_1234.HEIC`) and `manifest.json` describes the rest. **Import** uploads
  such a file in 32 MB parts (so it fits behind proxies such as Cloudflare, and resumes after a cut: choose the same
  file again), shows what it holds and then either **merges** it (adds what is missing; never changes or deletes
  anything; a milestone already exists when its date, title and children match, even in the trash) or **replaces
  everything** (restores the copy exactly, with the same milestone links; the importing administrator is kept). It
  runs in the background with its progress, can be cancelled while it processes the photos and is all-or-nothing: if
  it fails, is cancelled or the server restarts, nothing has changed. A report lists what was created, what was
  already there and anything that could not be imported. Passwords are not part of a copy (see
  [Backups and restore](deployment.md#backups-and-restore)).

## Everywhere

- Spanish (default), English and Portuguese (Portugal), chosen from the language menu in the header (the account
  panel on phones); responsive layout, keyboard and screen-reader support.
- Five colour themes, each with a light and a dark version: **Atardecer** (warm cream and the logo's gold, coral and
  rose; the default), **Océano** (blues and turquoises), **Bosque** (sage, forest green and terracotta), **Lavanda**
  (lilac, violet and pink) and **Grafito** (sober neutral greys, so the photos stand out). Everyone picks their theme
  and mode (automatic, light or dark) on their own device from the header's theme menu (the account panel on phones).
  Each theme brings its own automatic colours for years and for the *Todos juntos* lines, and adjusts the categories'
  colours so rings, badges and lines stay easy to see.
- **Cambiar contraseña** in the user menu (it asks for the current one and signs you out on your other devices).
- **Novedades** (*What's new*): when someone opens Timelife after an update brought something they will notice, a
  window tells them in a couple of plain sentences, in their language: everything new since they last looked (several
  updates together), new things first, each with a button to go and try it when it has a place in the app. Closing it
  counts them as read, on every device. People who have just joined start with nothing to catch up on, and viewers
  never see the notes about the administration pages. **Novedades** in the user menu lists every note again, by month.
- Installable on a phone's home screen with the Timelife icon: Safari's **Share → Add to Home Screen** on iOS/iPadOS,
  Chrome's **Add to Home screen** (or **Install app**) on Android. It then opens as an app, without the browser's
  address bar, and can [send notifications](#notifications); add it while signed in and it starts signed in (iOS
  copies the session since 17.2).

## Privacy and security

- No public registration: people sign in with the e-mail and password an administrator gave them (a temporary
  password they replace at their first sign-in) and, when it is configured, with Google using that same e-mail. The
  first administrator is created from the login page of a new installation; a command prints a single-use link to
  recover administrator access. A development login exists only for local stacks bound to loopback.
- Passwords (8–200 characters) are stored as salted scrypt hashes; sign-in answers the same, and takes as long, for
  unknown e-mails, accounts without a password and wrong passwords. With an SMTP server, *¿Has olvidado tu
  contraseña?* e-mails a link valid for one hour and one use, without revealing whether the e-mail has an account.
  Every new password signs the account out everywhere else.
- Uploaded photos are re-encoded into WebP thumbnails and display copies without metadata (EXIF/GPS); videos and Live
  Photo clips are re-encoded (or remuxed) into MP4 without metadata (place, device, dates). Originals are kept on disk
  but never served, and every photo and video requires a signed-in session. A Live Photo switched off keeps its clip
  away from viewers.
- HttpOnly, SameSite=Strict session cookies; `Origin` + `X-Timelife-Request` CSRF protection; host allow-list; strict
  Content-Security-Policy; request size limits and throttling of sign-ins, password e-mails and links.
- Notifications are encrypted for the device that asked for them (only it can read them) and travel through its
  browser's push service (Apple, Google, Mozilla or Microsoft), the only addresses the server sends them to; they
  carry the title of a milestone (a new one's also its children's names and who added it) or, on a birthday, a
  child's name and age, never photos, notes or places.
- Non-root container with `no-new-privileges`; PostgreSQL is not published to the host.
