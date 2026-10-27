// Disposable CI provisioning only. Does not reset any existing database or change an existing role.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { localUrl } from './recovery.mjs';
process.umask(0o077);
let db;
try {
  if(process.argv.includes('--verify')) {
    // Read-only local lifecycle check against the separately provisioned native stack.
    const url=localUrl(process.env.TEST_DATABASE_URL);
    if(url.pathname!=='/wedding_test')throw Error();
    db=postgres(url.href,{max:1});
    const [role]=await db`select current_database() as database,current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user`;
    if(role.database!=='wedding_test'||role.name!=='wedding_app'||role.rolsuper||role.rolbypassrls)throw Error();
    const api=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);if(!['localhost','127.0.0.1','[::1]'].includes(api.hostname))throw Error();
    const settings=await fetch(new URL('/auth/v1/settings',api),{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}});
    const result=await settings.json();if(!settings.ok||!result.disable_signup||!result.external?.email)throw Error();
    const storage=createClient(api.href,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}}).storage;
    if((await storage.listBuckets()).error)throw Error();
    console.log('LOCAL_LIFECYCLE_VERIFIED restricted_db=true signup_disabled=true email_enabled=true storage_available=true');
  } else {
    if(process.env.CI!=='true'||!process.env.CI_SUPABASE_STATUS_FILE)throw Error();
    const status=JSON.parse(await readFile(process.env.CI_SUPABASE_STATUS_FILE,'utf8'));
    const source=localUrl(status.DB_URL);if(source.pathname!=='/postgres')throw Error();
    const api=new URL(status.API_URL);if(!['localhost','127.0.0.1','[::1]'].includes(api.hostname))throw Error();
    db=postgres(source.href,{max:1,onnotice:()=>{}});
    if((await db`select 1 from pg_database where datname='wedding_test'`).length||(await db`select 1 from pg_roles where rolname='wedding_app'`).length)throw Error();
    const password=randomBytes(32).toString('hex');
    await db.unsafe(`create role wedding_app login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password '${password}'`);
    await db.unsafe('create database wedding_test');
    source.pathname='/wedding_test';const app=new URL(source);app.username='wedding_app';app.password=password;
    const env={DATABASE_URL:app.href,TEST_DATABASE_URL:app.href,DATABASE_ADMIN_URL:source.href,TEST_DATABASE_ADMIN_URL:source.href,NEXT_PUBLIC_SUPABASE_URL:api.href,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY,SUPABASE_SECRET_KEY:status.SERVICE_ROLE_KEY,APP_ORIGIN:'http://127.0.0.1:3100',RATE_LIMIT_HMAC_KEY:randomBytes(32).toString('base64'),ALLOW_INSECURE_LOCAL_COOKIES:'true'};
    if(Object.values(env).some(x=>typeof x!=='string'||!x))throw Error();
    await writeFile('.env.local',Object.entries(env).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
    console.log('DISPOSABLE_CI_BOOTSTRAP_COMPLETE');
  }
} catch { console.error('CI_BOOTSTRAP_FAILED: verify disposable local stack and private environment.');process.exitCode=1; }
finally {await db?.end({timeout:2});}
