import { it, expect } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { withTestDb, seedGuestSession, seedOrganizer } from '../helpers/database';
import { acceptedInput } from '../fixtures/wedding';
import { createRsvp } from '@/features/rsvp/service';
import { readContent, saveContent } from '@/features/organizer/content';
import { readAllResponses } from '@/features/organizer/responses';
import { computeMetrics } from '@/features/organizer/metrics';
import { uploadPhoto } from '@/lib/storage/server';
const exec = promisify(execFile);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
it('restores a real nonempty encrypted snapshot into isolated DB/storage and edits it through restored HTTP', async () => {
  await withTestDb(async db => {
    const started = Date.now();
    const folder = await mkdtemp(join(tmpdir(), 'wedding-recovery-'));
    const suffix = randomBytes(5).toString('hex'), target = `wedding_restore_test_${suffix}`;
    const bucket = `wedding-photos-restore-test-${suffix}`;
    const adminUrl = new URL(process.env.TEST_DATABASE_ADMIN_URL!);
    const restoredUrl = new URL(process.env.TEST_DATABASE_URL!); restoredUrl.pathname = `/${target}`;
    const admin = postgres(adminUrl.href, {max:1, onnotice:()=>{}});
    const restored = postgres(restoredUrl.href, {max:1, onnotice:()=>{}});
    const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {auth:{persistSession:false}}).storage;
    let server: ChildProcess | undefined;
    const env = {...process.env, DATABASE_ADMIN_URL: adminUrl.href, DATABASE_URL: process.env.TEST_DATABASE_URL!, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), PHOTO_BUCKET:'wedding-photos-test'};
    const cli = (script:string,args:string[],extra:Partial<NodeJS.ProcessEnv>={}) => exec(process.execPath,[`scripts/${script}.mjs`,...args],{env:{...env,...extra},timeout:90_000});
    try {
      const guest = await seedGuestSession('group-1', db), organizer = await seedOrganizer(db);
      const token = randomBytes(32).toString('base64url');
      const saved = await createRsvp(guest.actor,'group-1',{requestId:randomUUID(),editToken:token,response:acceptedInput()},db);
      const initial = await readContent(organizer.actor,db);
      initial.content.welcome.en = 'Synthetic recovery rehearsal welcome';
      await saveContent(organizer.actor,{...initial,expectedRevision:1},db);
      const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
      const photo = await uploadPhoto(organizer.actor,new File([image],'synthetic.png',{type:'image/png'}),{en:'Recovery sample',hi:'उदाहरण'},'Synthetic test image',{expectedRevision:2},db);
      const original = await readAllResponses(organizer.actor,db), originalContent = await readContent(organizer.actor,db);
      const originalMetrics = computeMetrics(original);
      const result = await cli('backup',['--destination',join(folder,'backup')]);
      const manifest = JSON.parse(result.stdout).manifest as string;
      const files = await readdir(join(folder,'backup'));
      expect(files.every(name=>name.endsWith('.enc'))).toBe(true);
      for(const name of files) expect((await readFile(join(folder,'backup',name))).includes(Buffer.from(token))).toBe(false);
      expect((await storage.from('wedding-photos-test').remove([photo.storagePath])).error).toBeNull();
      await expect(cli('backup',['--destination',join(folder,'missing-source-photo')])).rejects.toThrow();
      expect((await storage.from('wedding-photos-test').upload(photo.storagePath,image,{contentType:'image/png'})).error).toBeNull();
      const restoreArgs = ['--manifest',manifest,'--target',target];
      await expect(cli('restore',restoreArgs,{BACKUP_ENCRYPTION_KEY:randomBytes(32).toString('base64')})).rejects.toThrow();
      const photoFile = join(folder,'backup','photo-0.enc'), encrypted = await readFile(photoFile);
      await rm(photoFile); await expect(cli('restore',restoreArgs)).rejects.toThrow();
      const corrupt = Buffer.from(encrypted); corrupt[corrupt.length-1]^=1;
      await writeFile(photoFile,corrupt,{mode:0o600}); await expect(cli('restore',restoreArgs)).rejects.toThrow();
      expect(await admin`select datname from pg_database where datname=${target}`).toHaveLength(0);
      await writeFile(photoFile,encrypted,{mode:0o600});
      await expect(cli('restore',['--manifest',manifest,'--target','wedding_dev'])).rejects.toThrow();
      const nonces = await Promise.all(files.map(async name=>JSON.parse(await readFile(join(folder,'backup',name),'utf8')).nonce));
      expect(new Set(nonces).size).toBe(files.length);
      for(const nonce of nonces)expect(Buffer.from(nonce,'base64')).toHaveLength(12);
      await cli('restore',restoreArgs);
      await expect(cli('restore',restoreArgs)).rejects.toThrow();
      // Even explicit overwrite must validate authentication before touching an existing target.
      await expect(cli('restore',[...restoreArgs,'--overwrite'],{BACKUP_ENCRYPTION_KEY:randomBytes(32).toString('base64')})).rejects.toThrow();
      expect((await readAllResponses(organizer.actor,restored)).length).toBe(1);
      for(const connection of [db,restored]) {
        const [role] = await connection`select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user`;
        expect(role).toEqual({name:'wedding_app',rolsuper:false,rolbypassrls:false});
        const tables = await connection`select relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) as owner from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='wedding' and relkind='r'`;
        expect(tables.length).toBeGreaterThan(10);
        for(const table of tables){ expect(table.relrowsecurity).toBe(true); expect(table.relforcerowsecurity).toBe(true); expect(table.owner).not.toBe('wedding_app'); }
      }
      const recoveryAdminUrl=new URL(adminUrl);recoveryAdminUrl.pathname=`/${target}`;
      const recoveryAdmin=postgres(recoveryAdminUrl.href,{max:1,onnotice:()=>{}});
      try {
        for(const role of ['anon','authenticated'])await expect(recoveryAdmin.begin(async tx=>{await tx.unsafe(`set local role ${role}`);await tx`select * from wedding.rsvp_submissions`;})).rejects.toMatchObject({code:'42501'});
      } finally {await recoveryAdmin.end({timeout:2});}
      const recovered = await readAllResponses(organizer.actor,restored);
      expect(recovered.length).toBe(original.length); expect(recovered).toEqual(original);
      expect(computeMetrics(recovered)).toEqual(originalMetrics);
      expect(await readContent(organizer.actor,restored)).toEqual(originalContent);
      const restoredPhoto = await storage.from(bucket).download(photo.storagePath);
      expect(restoredPhoto.error).toBeNull();
      expect(digest(new Uint8Array(await restoredPhoto.data!.arrayBuffer()))).toBe(digest(image));
      const origin='http://127.0.0.1:3300';
      const {createServer}=await import('node:net');
      await new Promise<void>((resolve,reject)=>{const check=createServer();check.once('error',reject);check.listen(3300,'127.0.0.1',()=>check.close(()=>resolve()));});
      await writeFile('tsconfig.restore.json', JSON.stringify({extends:'./tsconfig.json',include:['next-env.d.ts','src/**/*.ts','src/**/*.tsx'],exclude:['node_modules']}));
      const serverEnv={...env,DATABASE_URL:restoredUrl.href,PHOTO_BUCKET:bucket,APP_ORIGIN:origin,NEXT_TEST_DIST_DIR:`.next-restore-test-${suffix}`,ALLOW_INSECURE_LOCAL_COOKIES:'true'};
      delete (serverEnv as Partial<typeof serverEnv>).BACKUP_ENCRYPTION_KEY;
      delete (serverEnv as Partial<typeof serverEnv>).DATABASE_ADMIN_URL;
      server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3300'],{env:serverEnv,stdio:'ignore'});
      let ready=false;
      for(let n=0;n<120;n++){try {if((await fetch(`${origin}/api/health`)).ok){ready=true;break;}}catch{} await delay(500);}
      expect(ready).toBe(true);
      const exchange=await fetch(`${origin}/api/rsvp/edit-session`,{method:'POST',headers:{Origin:origin,Cookie:`wedding_guest=${guest.cookie}`,'Content-Type':'application/json'},body:JSON.stringify({token})});
      expect(exchange.status).toBe(200);
      const cookie=`wedding_guest=${guest.cookie}; ${exchange.headers.getSetCookie().find(c=>c.startsWith('wedding_edit='))!.split(';')[0]}`;
      const response=await fetch(`${origin}/api/rsvp/current`,{headers:{Cookie:cookie}});
      expect(response.status).toBe(200);expect(await response.json()).toEqual(original[0]);
      const edited=await fetch(`${origin}/api/rsvp/current`,{method:'PATCH',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({expectedSubmissionId:saved.id,expectedVersion:1,response:acceptedInput({questions:'Restored HTTP edit succeeded'})})});
      expect(edited.status).toBe(200);
      expect((await readAllResponses(organizer.actor,restored))[0].version).toBe(2);
      expect(await readAllResponses(organizer.actor,db)).toEqual(original);
      const photoResponse=await fetch(`${origin}/api/photos/${photo.id}`,{headers:{Cookie:cookie}});
      expect(photoResponse.status).toBe(200); expect(digest(new Uint8Array(await photoResponse.arrayBuffer()))).toBe(digest(image));
      await mkdir("test-results",{recursive:true});
      const evidence=`RECOVERY_VERIFIED parties=${recovered.length} guests=${originalMetrics.attendingGuests} photos=1 source_unchanged=true restored_http_edit=200 elapsed_ms=${Date.now()-started}`;
      await writeFile("test-results/recovery-evidence.txt", evidence+"\n", {mode:0o600});
    } finally {
      if(server){server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server!.once('exit',resolve)),delay(4000)]);if(server.exitCode===null)server.kill('SIGKILL');}
      await restored.end({timeout:2});
      await admin.unsafe(`drop database if exists "${target}" with (force)`);
      await admin.end({timeout:2});
      const exists=await storage.getBucket(bucket);if(exists.data){await storage.emptyBucket(bucket);await storage.deleteBucket(bucket);}
      await rm('tsconfig.restore.json',{force:true});await rm(folder,{recursive:true,force:true});await rm(`.next-restore-test-${suffix}`,{recursive:true,force:true});
    }
  });
},180_000);
