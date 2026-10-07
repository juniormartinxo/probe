export function testDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    `postgres://probe:probe@localhost:${process.env.PROBE_DB_PORT ?? "5434"}/probe_test`
  );
}
