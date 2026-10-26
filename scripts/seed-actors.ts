/**
 * Retired: the legacy actor seeder reset credentials and privileged state in shared databases.
 * See docs/security/RBAC_BOOTSTRAP.md for supported setup and legacy account response.
 * Keep this entry point as an explicit refusal for old automation; never load .env or connect.
 */
console.error('Actor seeding is disabled. See docs/security/RBAC_BOOTSTRAP.md.');
process.exitCode = 1;
