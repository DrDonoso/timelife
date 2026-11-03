# Security policy

Timelife guards a family's photos, videos and milestones, so security reports are very welcome.

## Supported versions

Only the latest release gets security fixes: the `latest` tag of the
[`drdonoso/timelife`](https://hub.docker.com/r/drdonoso/timelife) image and the newest `YYYYMMDD` tag. Keep your
instance up to date:

```sh
docker compose pull && docker compose up -d
```

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately on GitHub instead:
[**Security → Report a vulnerability**](https://github.com/DrDonoso/timelife/security/advisories/new).

Please include:

- what is affected (endpoint, page, configuration) and the version you run (`/api/version`, also shown in the
  administration footer);
- the steps to reproduce it, or a proof of concept;
- the impact you expect (what an attacker could see or do).

Timelife is maintained in spare time, so replies are best effort: expect an acknowledgement within a week. Once a fix
is released, the advisory is published and you are credited, unless you prefer otherwise.

## Scope

In scope: the backend (`src/timelife/`), the web app (`frontend/`), the Docker image and the Compose files in this
repository.

Out of scope:

- the [public demo](https://demo.timelife.lauvid.com): a static site whose "API" runs inside your own browser on
  sample data, with nothing stored or sent anywhere;
- problems that need a deployment configured against the documentation, such as the development login
  (`ALLOW_INSECURE_LOCAL_LOGIN=true`) on a public server, `AUTH_COOKIE_SECURE=false` over plain HTTP or
  `TRUSTED_PROXY_IPS=*`;
- denial of service with uploads within the configured size limits, or volumetric attacks;
- vulnerabilities in dependencies without a demonstrated impact on Timelife (Dependabot tracks those).
