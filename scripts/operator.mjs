// Explicit Node-only operator entrypoints reuse the server seed validator.
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const sourceRoot = new URL('../src/', import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'server-only') return { url: new URL('../node_modules/server-only/empty.js', import.meta.url).href, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const url = new URL(`${specifier.slice(2)}.ts`, sourceRoot);
      if (!url.href.startsWith(sourceRoot.href)) throw new Error('INVALID_SOURCE_IMPORT');
      return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot.href) && url.endsWith('.ts')) return { format: 'module', source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true };
    return next(url, context);
  },
});

export function localDatabaseUrl(value, expectedName) {
  try {
    const url = new URL(value ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || decodeURIComponent(url.pathname.slice(1)) !== expectedName || url.search || url.hash) throw new Error();
    return url.href;
  } catch { throw new Error('UNSAFE_LOCAL_DATABASE'); }
}

export async function ensurePrivateBucket(client, name) {
  if (!['wedding-photos-dev', 'wedding-photos-test'].includes(name)) throw new Error('INVALID_PHOTO_BUCKET');
  let result = await client.storage.getBucket(name);
  if (result.error && String(result.error.statusCode ?? result.error.status) === '404') {
    const created = await client.storage.createBucket(name, { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] });
    if (created.error) throw new Error('PRIVATE_STORAGE_UNAVAILABLE');
    result = await client.storage.getBucket(name);
  }
  if (result.error || !result.data) throw new Error('PRIVATE_STORAGE_UNAVAILABLE');
  const types = ['image/jpeg', 'image/png', 'image/webp'];
  if (result.data.public !== false || Number(result.data.file_size_limit) !== 10 * 1024 * 1024 || JSON.stringify([...(result.data.allowed_mime_types ?? [])].sort()) !== JSON.stringify(types)) {
    const updated = await client.storage.updateBucket(name, { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: types });
    if (updated.error) throw new Error('PRIVATE_STORAGE_UNAVAILABLE');
    result = await client.storage.getBucket(name);
  }
  if (result.error || result.data?.public !== false || Number(result.data.file_size_limit) !== 10 * 1024 * 1024 || JSON.stringify([...(result.data.allowed_mime_types ?? [])].sort()) !== JSON.stringify(types)) throw new Error('PRIVATE_STORAGE_UNAVAILABLE');
}
