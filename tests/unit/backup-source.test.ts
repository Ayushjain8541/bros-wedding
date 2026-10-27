// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { runPg } from '../../scripts/recovery.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as httpsServer } from 'node:https';
import { createServer as tcpServer } from 'node:net';
import { createSecureContext, TLSSocket } from 'node:tls';
import { backupSource, sourceDatabase, sourcePgEnvironment, verifiedStorageFetch, assertSourceIdentity, assertSourceBucket, SOURCE_TABLES } from '../../scripts/backup-source.mjs';
const local={DATABASE_ADMIN_URL:'postgres://postgres:synthetic@127.0.0.1:5432/wedding_test',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SECRET_KEY:'synthetic-secret'};
const hosted={BACKUP_SOURCE_MODE:'hosted',BACKUP_HOSTED_SOURCE_ACK:'I_APPROVE_THIS_HOSTED_BACKUP_SOURCE',BACKUP_DATABASE_URL:'postgres://backup:synthetic@db.example.test:5432/postgres',BACKUP_EXPECTED_DATABASE:'postgres',BACKUP_EXPECTED_DATABASE_USER:'backup',BACKUP_SUPABASE_URL:'https://storage.example.test',BACKUP_SUPABASE_SECRET_KEY:'synthetic-secret',BACKUP_PHOTO_BUCKET:'private-couple'};
it('keeps safe local defaults and requires complete acknowledged hosted source configuration',async()=>{
 const safe=await backupSource(local);expect(safe.mode).toBe('local');expect(safe.bucket).toBe('wedding-photos-test');expect(safe.databaseOptions.ssl).toBe(false);
 const remote=await backupSource(hosted);expect(remote.databaseOptions.ssl).toEqual({rejectUnauthorized:true});expect(remote.bucket).toBe('private-couple');expect(remote.databaseOptions.connection).toEqual({statement_timeout:120_000,idle_in_transaction_session_timeout:120_000});
 for(const key of Object.keys(hosted))if(key!=='BACKUP_SOURCE_MODE')await expect(backupSource({...hosted,[key]:''})).rejects.toThrow();
 for(const override of [{BACKUP_SOURCE_MODE:'unknown'},{BACKUP_DATABASE_URL:hosted.BACKUP_DATABASE_URL+'?sslmode=disable'},{BACKUP_DATABASE_URL:hosted.BACKUP_DATABASE_URL+'#fragment'},{BACKUP_EXPECTED_DATABASE:'wrong'},{BACKUP_SUPABASE_URL:'http://storage.example.test'},{BACKUP_SUPABASE_URL:'https://user:secret@storage.example.test'},{BACKUP_SUPABASE_URL:'https://storage.example.test/path'},{BACKUP_PHOTO_BUCKET:'../escape'}])await expect(backupSource({...hosted,...override})).rejects.toThrow();
 await expect(backupSource({...local,DATABASE_ADMIN_URL:hosted.BACKUP_DATABASE_URL})).rejects.toThrow();
 await expect(backupSource({...local,BACKUP_DATABASE_URL:hosted.BACKUP_DATABASE_URL})).rejects.toThrow();
});
it('binds actual source identity, TLS state, application schema and private bucket',async()=>{
 const source=await backupSource(hosted),tables=SOURCE_TABLES.map(name=>({name,owner:'postgres',rls:true,forced:true}));
 const identity={name:'postgres',user:'backup',ssl:true};
 expect(()=>assertSourceIdentity(source,identity,tables)).not.toThrow();
 for(const bad of [{...identity,name:'other'},{...identity,user:'other'},{...identity,ssl:false}])expect(()=>assertSourceIdentity(source,bad,tables)).toThrow();
 expect(()=>assertSourceIdentity(source,identity,tables.slice(1))).toThrow();
 expect(()=>assertSourceIdentity(source,identity,[...tables,{name:'unsafe',owner:'wedding_app',rls:false,forced:false}])).toThrow();
 expect(()=>assertSourceBucket(source,{id:'private-couple',public:false})).not.toThrow();
 for(const bucket of [{id:'other',public:false},{id:'private-couple',public:true},{id:'private-couple'}])expect(()=>assertSourceBucket(source,bucket)).toThrow();
 const env=sourcePgEnvironment(source,{PGSSLMODE:'disable',PGSSLROOTCERT:'wrong',PGHOSTADDR:'1.2.3.4',PGSERVICE:'unsafe',PGOPTIONS:'unsafe',PGGSSENCMODE:'require'});
 expect(env.PGSSLMODE).toBe('verify-full');expect(env.PGSSLROOTCERT).toBe('system');expect(env.PGGSSENCMODE).toBe('disable');expect(env.PGHOST).toBe('db.example.test');
 expect(env).not.toHaveProperty('PGHOSTADDR');expect(env).not.toHaveProperty('PGSERVICE');expect(env).not.toHaveProperty('PGOPTIONS');
});
it('rejects untrusted local TLS endpoints and accepts only an explicitly trusted Storage CA',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'backup-tls-'));
 const key=join(folder,'key.pem'),cert=join(folder,'cert.pem');
 const sockets=new Set<TLSSocket>();
 let https:ReturnType<typeof httpsServer>|undefined,tcp:ReturnType<typeof tcpServer>|undefined;
 let db:ReturnType<typeof sourceDatabase>|undefined;
 try{
  await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1']);
  const tls={key:await readFile(key),cert:await readFile(cert)};
  https=httpsServer(tls,(req,res)=>{if(req.url==='/stall')return;if(req.url==='/redirect'){res.writeHead(302,{Location:'https://other.example.test'});res.end();return;}res.writeHead(200,{'Content-Type':'application/json'});res.end('{"private":true}');});
  await new Promise<void>(resolve=>https!.listen(0,'127.0.0.1',resolve));const address=https.address() as {port:number};
  const url=`https://127.0.0.1:${address.port}`;
  const untrusted=await backupSource({...hosted,BACKUP_SUPABASE_URL:url});
  await expect(verifiedStorageFetch(untrusted)(url)).rejects.toThrow();
  const trusted=await backupSource({...hosted,BACKUP_SUPABASE_URL:url,BACKUP_STORAGE_CA_FILE:cert,BACKUP_DATABASE_CA_FILE:cert});
  expect(await (await verifiedStorageFetch(trusted)(url)).json()).toEqual({private:true});
  expect(sourcePgEnvironment(trusted,{}).PGSSLROOTCERT).toBe(cert);
  expect((await verifiedStorageFetch(trusted)(url+'/redirect')).status).toBe(302);
  const bounded=await backupSource({...hosted,BACKUP_SUPABASE_URL:url,BACKUP_STORAGE_CA_FILE:cert,BACKUP_OPERATION_TIMEOUT_MS:'1000'});
  await expect(verifiedStorageFetch(bounded)(url+'/stall')).rejects.toThrow('BACKUP_STORAGE_TIMEOUT');
  await expect(verifiedStorageFetch(trusted)('http://127.0.0.1')).rejects.toThrow();
  await expect(verifiedStorageFetch(trusted)('https://other.example.test')).rejects.toThrow();
  tcp=tcpServer(socket=>{socket.once('data',()=>{socket.write('S');const secure=new TLSSocket(socket,{isServer:true,secureContext:createSecureContext(tls)});sockets.add(secure);secure.on('error',()=>secure.destroy());secure.on('close',()=>sockets.delete(secure));});});
  await new Promise<void>(resolve=>tcp!.listen(0,'127.0.0.1',resolve));const pgAddress=tcp.address() as {port:number};
  const pgSource=await backupSource({...hosted,BACKUP_DATABASE_URL:`postgres://backup:synthetic@127.0.0.1:${pgAddress.port}/postgres`});
  db=sourceDatabase(pgSource);await expect(db`select 1`).rejects.toThrow(/self.signed|certificate/i);
 }finally{await db?.end({timeout:1});for(const socket of sockets)socket.destroy();await Promise.all([https&&new Promise<void>(resolve=>https!.close(()=>resolve())),tcp&&new Promise<void>(resolve=>tcp!.close(()=>resolve()))]);await rm(folder,{recursive:true,force:true});}
},15_000);

it('terminates a stalled operator subprocess within its configured limit',async()=>{
 vi.stubEnv('PG_BIN_DIR','');
 try {await expect(runPg(process.execPath,{},['-e','setInterval(()=>{},1000)'],100)).rejects.toThrow('POSTGRES_OPERATOR_COMMAND_FAILED');}
 finally {vi.unstubAllEnvs();}
});
