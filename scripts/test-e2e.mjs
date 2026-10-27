import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Playwright sets FORCE_COLOR in its workers. Remove inherited color controls at
// the launcher boundary so NO_COLOR cannot contradict that worker policy.
const env={...process.env};delete env.NO_COLOR;delete env.FORCE_COLOR;
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/@playwright/test/cli.js',import.meta.url)),'test',...process.argv.slice(2)],{env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('BROWSER_TEST_LAUNCH_FAILED');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
