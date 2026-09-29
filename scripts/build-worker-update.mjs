import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {workerUpdatePackage} from '../server/worker-package.mjs';
import {workerVersion} from './remote-worker.mjs';

const directory=new URL('../build/',import.meta.url);await mkdir(directory,{recursive:true});
const output=new URL(`sonara-worker-update-${workerVersion}.zip`,directory),data=await workerUpdatePackage();await writeFile(output,data);
const localDownloads=new URL('../dist/downloads/',import.meta.url);await mkdir(localDownloads,{recursive:true});
await writeFile(new URL(`sonara-worker-update-${workerVersion}.zip`,localDownloads),data);
console.log(`Worker update package (no credentials): ${fileURLToPath(output)}`);
