# Security and private deployment

Keep `.env`, PostgreSQL exports, uploaded documents and Google service-account keys outside Git. The repository intentionally contains no organization data or sample accounts. A new database creates only the administrator supplied by environment configuration.

Use HTTPS for internet access and set `TARAZ_COOKIE_SECURE=1`. Keep PostgreSQL private, grant the application its own database user and restrict access to backups. Do not put production credentials into issue descriptions or logs. Report security issues privately to the repository owner.

The server validates authorization on actions and filters returned state by role; the client is not the authorization boundary. Test permissions and database migrations before deploying upgrades. Deployment files are starting configurations, not a substitute for your organization's operations policy.

Company-wide Backup & Restore is restricted to active CEO accounts and requires password reauthentication. Portable `.avandbackup` files are authenticated and encrypted using AES-256-GCM and a separate scrypt-derived passphrase. Treat them as confidential even when encrypted: they include password hashes, private records and uploaded files. Use HTTPS on the management connection, store backup passphrases separately, and never commit backup files. The in-app transfer limit is 128 MB; use PostgreSQL tooling for larger databases. Restore replaces the destination atomically, invalidates sessions, and retains the latest encrypted destination snapshot. Server environment variables and integration credentials are not migrated.
