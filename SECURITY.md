# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |

## Reporting a vulnerability

Please do **not** report security vulnerabilities through public GitHub issues.

Instead, open a GitHub Security Advisory via the repository's
**Security → Report a vulnerability** tab. Include:

- The affected version and how you run Open Admin (standalone vs embedded)
- Steps to reproduce or a proof of concept
- The impact you believe it has

We aim to acknowledge reports within **72 hours** and will work with you on a
coordinated disclosure timeline.

## Security model notes

Open Admin is an *embeddable* admin panel and relies on the host application
for authentication:

- Set the `auth` option (an async `(req) => boolean` hook) to gate every
  request when exposed beyond localhost. Without it, anyone who can reach the
  port can use the API.
- The single deliberate exception is `POST /api/social/feedback`, which must
  stay reachable by unauthenticated site visitors.
- CORS is intentionally permissive (`*`) so the drop-in feedback widget works
  from any site. Do not put sensitive data in the admin behind this setup
  without fronting it with your own auth/proxy.
- State is plain JSON files in `dataDir` — protect that directory like any
  other user data.
