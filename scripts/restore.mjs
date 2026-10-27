import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import postgres from 'postgres';
import { args, key, localUrl, storage, open, pg, fail, hash } from './recovery.mjs';
process.umask(0o077);
if(process.argv.includes('--help')){console.log('restore.mjs --manifest <manifest.enc> --target wedding_restore_test_<suffix> [--overwrite]\nOnly isolated loopback recovery DB/bucket targets. Explicit --overwrite replaces that recovery target. Operator env: DATABASE_ADMIN_URL, BACKUP_ENCRYPTION_KEY, local Supabase URL/secret, optional PG_BIN_DIR. Application/Auth secrets are recovered separately.');process.exit(0);}
let admin,scratch;
try {
  const options=args(['--manifest','--target','--overwrite']),target=options['--target'];
  if(!/^wedding_restore_test_[a-z0-9_]{1,32}$/.test(target??''))throw Error('UNSAFE_RESTORE_TARGET');
  const url=localUrl(process.env.DATABASE_ADMIN_URL);if(!['wedding_dev','wedding_test'].includes(decodeURIComponent(url.pathname.slice(1))))throw Error('UNSAFE_OPERATOR_CONNECTION');
  const secret=key(),manifestPath=resolve(options['--manifest']??'');
  const opened=await open(manifestPath,secret);if(opened.metadata.kind!=='manifest')throw Error('INVALID_MANIFEST');
  const manifest=JSON.parse(opened.bytes);
  if(manifest.version!==1||manifest.secretsIncluded!==false||!Array.isArray(manifest.files)||!manifest.schemaVersion||!Array.isArray(manifest.migrations))throw Error('INVALID_MANIFEST');
  const files=[],names=new Set(),paths=new Set();
  for(const entry of manifest.files){
    if(!/^(database|photo-[0-9]+)\.enc$/.test(entry.file)||names.has(entry.file))throw Error('INVALID_INVENTORY');names.add(entry.file);
    if(entry.kind==='database'){if(entry.file!=='database.enc')throw Error('INVALID_DUMP');}
    else if(entry.kind==='photo') {if(!/^photos\/[a-f0-9-]+\.(png|jpg|webp)$/.test(entry.storagePath)||paths.has(entry.storagePath)||!['image/png','image/jpeg','image/webp'].includes(entry.contentType))throw Error('INVALID_PHOTO');paths.add(entry.storagePath);}
    else throw Error('INVALID_KIND');
    const file=await open(join(dirname(manifestPath),entry.file),secret);
    if(JSON.stringify(file.metadata)!==JSON.stringify(entry))throw Error('INVENTORY_MISMATCH');files.push({...entry,bytes:file.bytes});
  }
  if(files.filter(f=>f.kind==='database').length!==1)throw Error('DUMP_REQUIRED');
  scratch=await mkdtemp(join(tmpdir(),'wedding-restore-'));
  const dump=join(scratch,'database.dump');await writeFile(dump,files.find(f=>f.kind==='database').bytes,{mode:0o600});
  await pg('pg_restore',url,['--list',dump]); // all decryption, checksums, inventory and archive checks precede mutation
  const client=storage(), bucket=`wedding-photos-restore-test-${target.slice('wedding_restore_test_'.length).replaceAll('_','-')}`;
  admin=postgres(url.href,{max:1,onnotice:()=>{}});
  const [role]=await admin`select rolsuper,rolbypassrls from pg_roles where rolname='wedding_app'`;
  if(!role||role.rolsuper||role.rolbypassrls)throw Error('RESTRICTED_APP_ROLE_REQUIRED');
  const existing=await admin`select datname from pg_database where datname=${target}`;
  const previousBucket=await client.getBucket(bucket);
  if(previousBucket.error&&String(previousBucket.error.statusCode??previousBucket.error.status)!=='404')throw Error('STORAGE_UNAVAILABLE');
  if((existing.length||previousBucket.data)&&!options['--overwrite'])throw Error('EXPLICIT_OVERWRITE_REQUIRED');
  if(existing.length)await admin.unsafe(`drop database "${target}" with (force)`);
  if(previousBucket.data){if((await client.emptyBucket(bucket)).error||(await client.deleteBucket(bucket)).error)throw Error('STORAGE_CLEANUP_FAILED');}
  await admin.unsafe(`create database "${target}"`);
  const restored=new URL(url);restored.pathname=`/${target}`;
  await pg('pg_restore',restored,['--exit-on-error','--single-transaction','--no-owner','--dbname',target,dump]);
  const made=await client.createBucket(bucket,{public:false,fileSizeLimit:10*1024*1024,allowedMimeTypes:['image/jpeg','image/png','image/webp']});if(made.error)throw Error('BUCKET_CREATE_FAILED');
  const checked=await client.getBucket(bucket);if(checked.error||checked.data.public)throw Error('PRIVATE_BUCKET_REQUIRED');
  for(const file of files.filter(f=>f.kind==='photo')) {const result=await client.from(bucket).upload(file.storagePath,file.bytes,{contentType:file.contentType,upsert:false});if(result.error)throw Error('PHOTO_RESTORE_FAILED');}
  const checkDb=postgres(restored.href,{max:1,onnotice:()=>{}});
  try {
    const refs=(await checkDb`select storage_path from wedding.content_photos`).map(row=>row.storage_path).sort();
    if(JSON.stringify(refs)!==JSON.stringify([...paths].sort()))throw Error('RESTORED_REFERENCE_MISMATCH');
    const policies=await checkDb`select relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) as owner from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='wedding' and relkind='r'`;
    if(!policies.length||policies.some(row=>!row.relrowsecurity||!row.relforcerowsecurity||row.owner==='wedding_app'))throw Error('RESTORED_ROLE_BOUNDARY_INVALID');
  } finally {await checkDb.end({timeout:2});}
  for(const file of files.filter(f=>f.kind==='photo')) {
    const downloaded=await client.from(bucket).download(file.storagePath);
    if(downloaded.error||hash(Buffer.from(await downloaded.data.arrayBuffer()))!==file.sha256)throw Error('RESTORED_PHOTO_CHECKSUM_MISMATCH');
  }
  console.log(JSON.stringify({status:'restored-isolated-unpromoted',target,bucket,secretsRestored:false}));
} catch {fail();}
finally {await admin?.end({timeout:2});if(scratch)await rm(scratch,{recursive:true,force:true});}
