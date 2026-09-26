import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CompositionService} from '../server/composition-service.mjs';
const service=await new CompositionService({root:resolve('.')}).init();
const idea=process.argv[2]||'写一段中文歌曲：忙碌了一天，独自坐末班车回家，看见便利店的暖灯，忽然觉得生活还是值得期待。克制温暖，有具体画面，结尾有一点重新出发的力量。';
const job=await service.create({requestId:randomUUID(),idea});console.log(JSON.stringify({id:job.id,state:job.state}));
await service.tail;const final=service.get(job.id);console.log(JSON.stringify({id:final.id,state:final.state,message:final.message,score:final.score},null,2));await service.close();if(final.state!=='draft')process.exitCode=1;
