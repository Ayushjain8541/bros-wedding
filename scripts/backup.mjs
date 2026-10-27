import { mkdir, mkdtemp, readFile, readdir, rm, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import postgres from 'postgres';
import { args, key, localUrl, storage, hash, seal, pg, fail } from './recovery.mjs';
process.umask(0o077);
if(process.argv.includes('--help')){console.log('backup.mjs --destination <NEW private directory>\nOperator env: DATABASE_ADMIN_URL (loopback wedding_dev/test), BACKUP_ENCRYPTION_KEY, local Supabase URL/secret, optional PG_BIN_DIR. No environment file is loaded automatically.');process.exit(0);}
let db, scratch, destination, created=false;
try {
  const options=args(['--destination']);if(!options['--destination'])throw Error('DESTINATION_REQUIRED');
  const secret=key(), url=localUrl(process.env.DATABASE_ADMIN_URL);
  const name=decodeURIComponent(url.pathname.slice(1));if(!['wedding_dev','wedding_test'].includes(name))throw Error('INVALID_SOURCE');
  destination=resolve(options['--destination']);const parent=await lstat(resolve(destination,'..'));
  if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('INVALID_PARENT');
  await mkdir(destination,{mode:0o700});created=true;
  scratch=await mkdtemp(join(tmpdir(),'wedding-backup-'));
  const client=storage(),bucket=name==='wedding_test'?'wedding-photos-test':'wedding-photos-dev';
  const bucketInfo=await client.getBucket(bucket);if(bucketInfo.error||bucketInfo.data.public)throw Error('PRIVATE_BUCKET_REQUIRED');
  db=postgres(url.href,{max:1,onnotice:()=>{}});
  const migrations=(await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
  const schema=await Promise.all(migrations.map(async file=>({file,sha256:hash(await readFile(join('supabase/migrations',file)))})));
  await db.begin('isolation level repeatable read',async tx=>{
    // Freeze references before exporting a coherent DB snapshot. Writers lock settings first.
    await tx`set local lock_timeout='10s'`;
    await tx`lock table wedding.site_settings, wedding.website_content, wedding.content_photos in share mode`;
    const [identity]=await tx`select current_database() as name`;
    if(identity.name!==name)throw Error('SOURCE_IDENTITY_MISMATCH');
    const [snapshot]=await tx`select pg_export_snapshot() as id`;
    const photos=await tx`select storage_path from wedding.content_photos order by position`;
    const dump=join(scratch,'database.dump');
    await pg('pg_dump',url,['--format=custom','--schema=wedding','--no-owner',`--snapshot=${snapshot.id}`,`--file=${dump}`]);
    const records=[];
    async function add(file,bytes,extra){const metadata={file,...extra,sha256:hash(bytes),bytes:bytes.length};await seal(join(destination,file),bytes,metadata,secret);records.push(metadata);}
    await add('database.enc',await readFile(dump),{kind:'database'});
    for(let i=0;i<photos.length;i++){
      const path=photos[i].storage_path;
      const result=await client.from(bucket).download(path);if(result.error||!result.data)throw Error('REFERENCED_PHOTO_MISSING');
      await add(`photo-${i}.enc`,Buffer.from(await result.data.arrayBuffer()),{kind:'photo',storagePath:path,contentType:result.data.type});
    }
    const manifest={version:1,createdAt:new Date().toISOString(),sourceDatabase:name,sourceBucket:bucket,schemaVersion:migrations.at(-1),migrations:schema,files:records,secretsIncluded:false};
    const bytes=Buffer.from(JSON.stringify(manifest));
    await seal(join(destination,'manifest.enc'),bytes,{kind:'manifest',sha256:hash(bytes),bytes:bytes.length},secret);
  });
  console.log(JSON.stringify({manifest:join(destination,'manifest.enc'),status:'encrypted'}));
} catch { if(created)await rm(destination,{recursive:true,force:true});fail(); }
finally {await db?.end({timeout:2});if(scratch)await rm(scratch,{recursive:true,force:true});}
