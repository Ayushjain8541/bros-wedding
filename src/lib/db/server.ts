import 'server-only';
import postgres from 'postgres';
import { readEnv } from '@/lib/env';
export type Database = ReturnType<typeof postgres>;
let database: Database | undefined;

/** One bounded pool per server process; remote connections require verified TLS. */
export function getDb(): Database {
  if (!database) {
    const env = readEnv();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.DATABASE_URL).hostname);
    database = postgres(env.DATABASE_URL, { max: 5, idle_timeout: 20, connect_timeout: 10, max_lifetime: 60 * 30, ssl: local ? false : { rejectUnauthorized: true }, onnotice: () => {} });
  }
  return database;
}
