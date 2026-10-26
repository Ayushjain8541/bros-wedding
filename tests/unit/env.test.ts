import { describe, expect, test } from 'vitest';
import { readEnv } from '@/lib/env';

describe('server environment', () => {
  test('rejects missing configuration without disclosing inputs', () => {
    expect(() => readEnv({})).toThrow('INVALID_SERVER_CONFIGURATION');
    expect(() => readEnv({ DATABASE_URL: 'a-private-password' })).toThrow('INVALID_SERVER_CONFIGURATION');
  });
  test('rejects unsafe database URLs and non-origin application URLs', () => {
    const valid = { DATABASE_URL: 'postgresql://wedding_app:synthetic@localhost:5432/wedding_dev', APP_ORIGIN: 'http://localhost:3000', NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', SUPABASE_SECRET_KEY: 'synthetic-secret', RATE_LIMIT_HMAC_KEY: 'a'.repeat(32) };
    expect(readEnv(valid).DATABASE_URL).toContain('wedding_dev');
    for (const override of [{ DATABASE_URL: 'https://example.com' }, { DATABASE_URL: 'postgres://postgres:synthetic@localhost:5432/wedding_dev' }, { APP_ORIGIN: 'http://localhost:3000/path' }, { DATABASE_URL: `${valid.DATABASE_URL}?sslmode=disable` }]) {
      expect(() => readEnv({ ...valid, ...override })).toThrow('INVALID_SERVER_CONFIGURATION');
    }
  });
});
