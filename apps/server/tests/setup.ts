/**
 * Loads .env for the integration suite, when there is one.
 *
 * No credential is hardcoded anywhere in this repository — not even a local
 * default — so the database tests read their URL from the environment and skip
 * loudly when it is absent.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // No .env. CI provides DATABASE_URL directly; the suite skips if neither exists.
}
