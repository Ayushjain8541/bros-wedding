import { it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { seal, open, hash } from '../../scripts/recovery.mjs';
it('authenticates metadata, detects wrong checksum independently of GCM, and uses private files/fresh 96-bit nonces',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'wedding-crypto-')),secret=randomBytes(32),bytes=Buffer.from('synthetic backup data');
  const metadata={file:'database.enc',kind:'database',sha256:hash(bytes),bytes:bytes.length};
  try {
    const first=join(folder,'first.enc'),second=join(folder,'second.enc');
    await seal(first,bytes,metadata,secret);await seal(second,bytes,metadata,secret);
    expect((await open(first,secret)).bytes).toEqual(bytes);
    const a=JSON.parse(await readFile(first,'utf8')),b=JSON.parse(await readFile(second,'utf8'));
    expect(a.nonce).not.toBe(b.nonce);expect(Buffer.from(a.nonce,'base64')).toHaveLength(12);
    expect((await stat(first)).mode&0o077).toBe(0);
    a.metadata.file='other.enc';await writeFile(first,JSON.stringify(a));
    await expect(open(first,secret)).rejects.toThrow();
    const invalid=join(folder,'wrong-checksum.enc');await seal(invalid,bytes,{...metadata,sha256:'0'.repeat(64)},secret);
    await expect(open(invalid,secret)).rejects.toThrow('CHECKSUM_MISMATCH');
    await expect(open(second,randomBytes(32))).rejects.toThrow();
  } finally {await rm(folder,{recursive:true,force:true});}
});
