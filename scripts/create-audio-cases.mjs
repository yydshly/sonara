import {mkdir,writeFile} from 'node:fs/promises';
import {createProject,interpretRequest,applyProposal,clone} from '../dist/core.mjs';
import {generateDemo,renderMix,encodeWav} from '../dist/audio-core.mjs';
await mkdir('validation/audio',{recursive:true});
const project=createProject(),before=clone(project.working),demo=generateDemo();
const sources=Object.fromEntries(before.tracks.map(t=>[t.id,demo.tracks[t.kind]]));
const original=renderMix(before,sources);
applyProposal(project,interpretRequest('副歌更有力量，保留旋律',project.working));
const revised=renderMix(project.working,sources);
await writeFile('validation/audio/01-original.wav',Buffer.from(encodeWav(original)));
await writeFile('validation/audio/02-chorus-refined.wav',Buffer.from(encodeWav(revised)));
const section=before.sections.find(s=>s.id==='chorus');let outsideDifferences=0,insideDifferences=0;
for(let i=0;i<original.left.length;i++){if(original.left[i]!==revised.left[i]){if(i/original.sampleRate<section.start||i/original.sampleRate>=section.end)outsideDifferences++;else insideDifferences++;}}
const evidence={source:'Original deterministic instrumental synthesis, no singing or AI generation',duration:before.duration,sampleRate:original.sampleRate,change:'Chorus drums x1.38, bass x1.18, harmony x1.10; melody unchanged',region:{start:section.start,end:section.end},outsideDifferences,insideDifferences,originalVersion:before,revisedVersion:project.working};
await writeFile('validation/audio/comparison.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify({outsideDifferences,insideDifferences,duration:before.duration,files:['validation/audio/01-original.wav','validation/audio/02-chorus-refined.wav']}));
if(outsideDifferences||!insideDifferences)process.exitCode=1;
