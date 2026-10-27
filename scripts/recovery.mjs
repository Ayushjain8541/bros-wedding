// Operator-only recovery primitives. Never imported by application handlers.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
export const hash = value => createHash('sha256').update(value).digest('hex');
export function key() {
  const value=process.env.BACKUP_ENCRYPTION_KEY ?? '';
  if(!/^[A-Za-z0-9+/]{43}=$/.test(value))throw Error('BACKUP_KEY_REQUIRED_32_BYTE_BASE64');
  const bytes=Buffer.from(value,'base64');if(bytes.length!==32)throw Error('BACKUP_KEY_INVALID');return bytes;
}
export function localUrl(value) {
  let url;try{url=new URL(value);}catch{throw Error('LOCAL_OPERATOR_DATABASE_REQUIRED');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.search||url.hash)throw Error('LOCAL_OPERATOR_DATABASE_REQUIRED');
  return url;
}
export function storage() {
  const url=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.protocol!=='http:')throw Error('LOCAL_STORAGE_REQUIRED');
  return createClient(url.href,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}}).storage;
}
export async function privateFile(path) {
  const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('PRIVATE_REGULAR_FILE_REQUIRED');
  return readFile(path);
}
export async function seal(path, bytes, metadata, secret) {
  const nonce=randomBytes(12), aad=Buffer.from(JSON.stringify(metadata));
  const cipher=createCipheriv('aes-256-gcm',secret,nonce);cipher.setAAD(aad);
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
  await writeFile(path,JSON.stringify({v:1,algorithm:'AES-256-GCM',nonce:nonce.toString('base64'),metadata,tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}),{mode:0o600,flag:'wx'});
}
export async function open(path, secret) {
  const envelope=JSON.parse(await privateFile(path));
  if(envelope.v!==1||envelope.algorithm!=='AES-256-GCM'||Buffer.from(envelope.nonce,'base64').length!==12||Buffer.from(envelope.tag,'base64').length!==16)throw Error('INVALID_ENCRYPTED_FILE');
  const decipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(envelope.nonce,'base64'));
  decipher.setAAD(Buffer.from(JSON.stringify(envelope.metadata)));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  const bytes=Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]);
  if(hash(bytes)!==envelope.metadata.sha256||bytes.length!==envelope.metadata.bytes)throw Error('CHECKSUM_MISMATCH');
  return {bytes,metadata:envelope.metadata};
}
export async function pg(tool, url, args) {
  // Credentials go through the subprocess environment, never argv or diagnostic output.
  const executable=process.env.PG_BIN_DIR ? join(process.env.PG_BIN_DIR,tool) : tool;
  const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:'disable'};
  await new Promise((resolve,reject)=>{const child=spawn(executable,args,{env,stdio:'ignore'});child.once('error',()=>reject(Error('POSTGRES_OPERATOR_BINARY_UNAVAILABLE')));child.once('exit',code=>code===0?resolve():reject(Error('POSTGRES_OPERATOR_COMMAND_FAILED')));});
}
export function args(allowed) {
  const out={};for(let i=2;i<process.argv.length;i++){const name=process.argv[i];if(!allowed.includes(name)||out[name])throw Error('INVALID_OPERATOR_ARGUMENT');out[name]=name==='--overwrite'?true:process.argv[++i];if(!out[name])throw Error('MISSING_OPERATOR_ARGUMENT');}return out;
}
export function fail() { console.error('RECOVERY_FAILED: verify private input, key, local target and operator prerequisites; no target is approved for use.');process.exitCode=1; }
