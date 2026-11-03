# First run, family access and passwords

The interface is in Spanish by default (English and Portuguese are one click away in the header's language menu), so
the names of buttons and pages are given here as they appear in Spanish.

## First run

1. Start Timelife and open it right away: a new installation has no administrator, so the login page shows **Crea la
   cuenta de administración**. Enter your e-mail, your name and a password: you are signed in as the administrator.
   (Until then anybody who opens the site could create that account, so do it as soon as it is reachable.)
2. In **Administración** (user menu → *Administración*, or `/admin`): add the children (**Niños**), review the
   categories (**Categorías**), choose colours (**Colores y apariencia**) and start adding events (**Eventos**).
3. Give your family access from **Administración → Usuarios → Dar acceso a alguien**: their e-mail, an optional name,
   a role and a temporary password (type one or press **Generar**, which shows it so you can pass it on). Tell them
   the address of Timelife, their e-mail and that password: at their first sign-in they choose their own. With Google
   configured the password is optional — they can simply use **Continuar con Google** with that e-mail (verified by
   Google; the first sign-in links the account).

## Roles

- **viewer** (*Lector*) — sees every child's timeline, the event details, photos and videos;
- **admin** — additionally adds and edits milestones, uploads photos and videos, and manages children, categories,
  appearance, users, the trash and backups.

Changing someone's role, disabling them or giving them a new password ends their sessions immediately. At least one
enabled administrator always remains, and nobody changes their own role or access.

## Forgotten passwords

With [SMTP](configuration.md#e-mail-smtp-setup-optional), people use **¿Has olvidado tu contraseña?** on the
login page. Otherwise an administrator opens **Usuarios** and presses the key button of that person (**Restablecer
la contraseña**): a new temporary password, which they replace at their next sign-in. Anyone with a password can
change it from the user menu (**Cambiar contraseña**).

## Lost administrator access

Say the only administrator forgot the password and there is no SMTP:

```sh
docker compose exec app python -m timelife.setup              # --minutes N: valid for N minutes (default 60)
```

It prints a link (`https://timelife.example.com/setup#…`, one per `PUBLIC_ORIGIN`) that works once, within the hour:
open it and enter an e-mail and a new password. An existing account gets that password, administrator rights and
access again (signed out everywhere else); another e-mail becomes a new administrator. Running the command again
replaces the link. Outside Docker: `uv run python -m timelife.setup`.

## Upgrading from a version with `ADMIN_EMAILS`

The variable is no longer used (remove it from `.env`): its accounts stay administrators like any other (no longer
locked), and everybody keeps signing in with Google while it is configured. To give someone a password, use
**Restablecer la contraseña**, *¿Has olvidado tu contraseña?* or, for yourself, the recovery link above.
