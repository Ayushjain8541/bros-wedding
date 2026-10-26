import { existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import postgres from 'postgres';
import { localDatabaseUrl } from './operator.mjs';

async function main() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const args=process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: node scripts/seed-access.mjs --group group-1|group-2 [--test] [--print-link]\nRotates the code and revokes existing group sessions. Only --print-link reveals the new local link.'); return; }
  const group=args[args.indexOf('--group')+1];
  if (!args.includes('--group') || !['group-1','group-2'].includes(group)) throw new Error();
  const test=args.includes('--test');
  const target=localDatabaseUrl(test ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL, test ? 'wedding_test' : 'wedding_dev');
  const origin=new URL(process.env.APP_ORIGIN ?? '');
  if (!['localhost','127.0.0.1','[::1]'].includes(origin.hostname) || origin.origin !== process.env.APP_ORIGIN) throw new Error();
  const code=randomBytes(32).toString('base64url');
  const hash=createHash('sha256').update(code).digest('hex');
  const db=postgres(target,{max:1,onnotice:()=>{}});
  try {
    const [identity]=await db`select current_database() as name, current_user as role`;
    if (identity.name !== (test ? 'wedding_test' : 'wedding_dev') || identity.role !== 'wedding_app') throw new Error();
    await db.begin(async tx => {
      const groups=await tx`update wedding.invitation_groups set code_hash=${hash},rotated_at=now() where id=${group} returning id`;
      if (groups.length !== 1) throw new Error();
      await tx`update wedding.guest_sessions set revoked_at=now() where group_id=${group} and revoked_at is null`;
    });
    console.log(args.includes('--print-link') ? `${origin.origin}/invite#${code}` : 'Invitation code rotated and group sessions revoked.');
  } finally { await db.end(); }
}
main().catch(()=>{console.error('Access rotation failed; check group and local operator configuration.');process.exitCode=1;});
