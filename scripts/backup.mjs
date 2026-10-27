import { mkdir, mkdtemp, readFile, readdir, rm, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { args, key, hash, seal, fail } from './recovery.mjs';
import { backupSource, sourceDatabase, sourceStorage, sourceDump, assertSourceIdentity, assertSourceBucket } from './backup-source.mjs';
process.umask(0o077);
if(process.argv.includes('--help')){console.log('backup.mjs --destination <NEW private directory>\nDefault local source: DATABASE_ADMIN_URL (loopback wedding_dev/test), local Supabase URL/secret. Hosted source: explicit BACKUP_SOURCE_MODE=hosted plus BACKUP_HOSTED_SOURCE_ACK, BACKUP_DATABASE_URL, BACKUP_EXPECTED_DATABASE/USER, BACKUP_SUPABASE_URL/SECRET_KEY and BACKUP_PHOTO_BUCKET. See .env.example/runbook. Both require BACKUP_ENCRYPTION_KEY; optional PG_BIN_DIR. No environment file is loaded automatically.');process.exit(0);}
let db, scratch, destination, created=false;
try {
  const options=args(['--destination']);if(!options['--destination'])throw Error('DESTINATION_REQUIRED');
  const secret=key(), source=await backupSource();
  const name=source.expectedDatabase;
  destination=resolve(options['--destination']);const parent=await lstat(resolve(destination,'..'));
  if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('INVALID_PARENT');
  await mkdir(destination,{mode:0o700});created=true;
  scratch=await mkdtemp(join(tmpdir(),'wedding-backup-'));
  const client=sourceStorage(source),bucket=source.bucket;
  const bucketInfo=await client.getBucket(bucket);if(bucketInfo.error)throw Error('PRIVATE_BUCKET_REQUIRED');
  assertSourceBucket(source,bucketInfo.data);
  db=sourceDatabase(source);
  const migrations=(await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
  const schema=await Promise.all(migrations.map(async file=>({file,sha256:hash(await readFile(join('supabase/migrations',file)))})));
  await db.begin('isolation level repeatable read',async tx=>{
    // Freeze references before exporting a coherent DB snapshot. Writers lock settings first.
    await tx`set local lock_timeout='10s'`;
    await tx`lock table wedding.site_settings, wedding.website_content, wedding.content_photos in share mode`;
    const [identity]=await tx`select current_database() as name,current_user as user,coalesce((select ssl from pg_stat_ssl where pid=pg_backend_pid()),false) as ssl`;
    const tables=await tx`select c.relname as name,pg_get_userbyid(c.relowner) as owner,c.relrowsecurity as rls,c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='wedding' and c.relkind='r'`;
    assertSourceIdentity(source,identity,tables);
    const [snapshot]=await tx`select pg_export_snapshot() as id`;
    const photos=await tx`select storage_path from wedding.content_photos order by position`;
    const dump=join(scratch,'database.dump');
    await sourceDump(source,['--format=custom','--schema=wedding','--no-owner',`--snapshot=${snapshot.id}`,`--file=${dump}`]);
    const records=[];
    async function add(file,bytes,extra){const metadata={file,...extra,sha256:hash(bytes),bytes:bytes.length};await seal(join(destination,file),bytes,metadata,secret);records.push(metadata);}
    await add('database.enc',await readFile(dump),{kind:'database'});
    for(let i=0;i<photos.length;i++){
      const path=photos[i].storage_path;
      const result=await client.from(bucket).download(path);if(result.error||!result.data)throw Error('REFERENCED_PHOTO_MISSING');
      await add(`photo-${i}.enc`,Buffer.from(await result.data.arrayBuffer()),{kind:'photo',storagePath:path,contentType:result.data.type});
    }
    const manifest={version:1,createdAt:new Date().toISOString(),sourceDatabase:name,sourceBucket:bucket,sourceMode:source.mode,sourceUser:source.expectedUser,sourceStorageOrigin:source.api.origin,schemaVersion:migrations.at(-1),migrations:schema,files:records,secretsIncluded:false};
    const bytes=Buffer.from(JSON.stringify(manifest));
    await seal(join(destination,'manifest.enc'),bytes,{kind:'manifest',sha256:hash(bytes),bytes:bytes.length},secret);
  });
  console.log(JSON.stringify({manifest:join(destination,'manifest.enc'),status:'encrypted'}));
} catch { if(created)await rm(destination,{recursive:true,force:true});fail(); }
finally {await db?.end({timeout:2});if(scratch)await rm(scratch,{recursive:true,force:true});}
