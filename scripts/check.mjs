import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const files=await readdir('dist');
for(const folder of ['server','scripts'])for(const file of (await readdir(folder)).filter(f=>f.endsWith('.mjs'))){const check=spawnSync(process.execPath,['--check',resolve(folder,file)],{encoding:'utf8'});if(check.status!==0){process.stderr.write(check.stderr);process.exit(1);}}
for(const file of files.filter(f=>/\.(mjs|js)$/.test(f))){const check=spawnSync(process.execPath,['--check',resolve('dist',file)],{encoding:'utf8'});if(check.status!==0){process.stderr.write(check.stderr);process.exit(1);}}
for(const file of files.filter(f=>/\.(mjs|js)$/.test(f))){const source=await readFile(resolve('dist',file),'utf8');for(const match of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)){if(!files.includes(match[1]))throw new Error(`${file}: missing ${match[1]}`);}}
for(const file of ['index.html','styles.css','app.js','ui.mjs','audio-worker.mjs'])if(!files.includes(file))throw new Error(`Missing ${file}`);
console.log(`Syntax and module links verified: ${files.length} public files.`);
