import {StudioError,makeProject,updateDraft,makeTask,reviewTask} from './studio-core.mjs';
const browserOnly=!!globalThis.SONARA_DEPLOYMENT;
let database;
const open=()=>database||=new Promise((resolve,reject)=>{const request=indexedDB.open('sonara-personal-studio',1);request.onupgradeneeded=()=>{for(const name of ['projects','audio'])request.result.createObjectStore(name,{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('无法打开浏览器作品库，请检查浏览器存储设置。'));});
async function read(store,id){const db=await open();return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store)[id?'get':'getAll'](id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function edit(id,fn,audio){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(['projects','audio'],'readwrite'),projects=tx.objectStore('projects'),r=projects.get(id);let result;r.onsuccess=()=>{try{result=fn(r.result);projects.put(result);if(audio)tx.objectStore('audio').put(audio);}catch(e){reject(e);tx.abort();}};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('作品未能保存，可能存储空间不足。请导出重要内容后重试。'));tx.onabort=()=>reject(new Error('本次保存没有完成。'));});}
async function api(path,method='GET',data){const binary=data instanceof Blob;const response=await fetch('/api/studio'+path,{method,headers:data?{'Content-Type':binary?(data.type||'application/octet-stream'):'application/json'}:undefined,body:data?(binary?data:JSON.stringify(data)):undefined});let value;try{value=await response.json();}catch{throw new StudioError('无法读取创作服务，请确认已启动最新的本机工作台。',503);}if(!response.ok)throw new StudioError(value.error||'创作服务未完成请求。',response.status);return value;}
const browserStatus=()=>({mode:'browser',storage:'当前浏览器',lyrics:[{id:'codex',name:'Codex',available:false},{id:'minimax-code',name:'MiniMax Code',available:false}],music:{id:'minimax-code',name:'MiniMax Code',available:false,message:'网页版支持保存想法、编辑歌词、导出 MiniMax 任务和导入音频；自动生成需要本机创作服务。'},cloudGeneration:false});
export const studioStore={
  browserOnly,
  status:()=>browserOnly?Promise.resolve(browserStatus()):api('/status'),
  connection:()=>browserOnly?Promise.resolve(browserStatus()):api('/connection','POST',{}),
  list:async()=>browserOnly?(await read('projects')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(p=>({id:p.id,title:p.draft.title||'未命名作品',idea:p.draft.idea,mode:p.draft.mode,updatedAt:p.updatedAt,revision:p.revision,takes:p.tasks.filter(t=>t.type==='music'&&t.state==='succeeded').length})):api('/projects'),
  get:async id=>{const p=browserOnly?await read('projects',id):await api('/projects/'+id);if(!p)throw new StudioError('找不到这首作品。',404);return p;},
  create:(draft,id=crypto.randomUUID())=>browserOnly?edit(id,old=>old||makeProject(id,draft)):api('/projects','POST',{id,draft}),
  save:(id,input)=>browserOnly?edit(id,p=>updateDraft(p,input)):api('/projects/'+id,'PUT',input),
  prepare:(id,input)=>browserOnly?edit(id,p=>{
    if(input.type==='lyrics')throw new StudioError('请在本机连接歌词模型；网页版也可以直接粘贴你已有的歌词。');
    const existing=p.tasks.find(t=>t.requestId===input.requestId);if(existing){if(existing.revision!==input.revision)throw new StudioError('请求内容已变化。',409);return p;}
    if(p.tasks.length>=150)throw new StudioError('当前作品任务较多，请导出后创建新的作品。',429);
    if(p.revision!==input.revision)throw new StudioError('请先保存最新歌词与方向。',409);
    const task=makeTask(p,{id:crypto.randomUUID(),requestId:input.requestId,type:'music'});return {...p,tasks:[...p.tasks,task],updatedAt:new Date().toISOString()};
  }):api('/projects/'+id+'/tasks','POST',input),
  run:(id,taskId)=>api(`/projects/${id}/tasks/${taskId}/run`,'POST',{}),
  cancel:(id,taskId)=>browserOnly?edit(id,p=>({...p,tasks:p.tasks.map(t=>t.id===taskId&&t.state==='prepared'?{...t,state:'cancelled'}:t)})):api(`/projects/${id}/tasks/${taskId}/cancel`,'POST',{}),
  importAudio:(id,taskId,file,metadata)=>browserOnly?edit(id,p=>{
    const task=p.tasks.find(t=>t.id===taskId);if(!task||task.type!=='music'||!['prepared','failed','interrupted'].includes(task.state))throw new StudioError('此版本已有音频或仍在运行，请创建新版本。',409);
    return {...p,updatedAt:new Date().toISOString(),tasks:p.tasks.map(t=>t.id===taskId?{...t,state:'succeeded',audio:metadata,source:'manual',note:'用户为这次任务导入的音频；歌词与情绪是否吻合仍需试听。',finishedAt:new Date().toISOString()}:t)};
  },{id:taskId,file}):api(`/projects/${id}/tasks/${taskId}/audio`,'POST',new Blob([file],{type:metadata.type})),
  audio:async(id,taskId)=>browserOnly?URL.createObjectURL((await read('audio',taskId)).file):`/api/studio/projects/${id}/tasks/${taskId}/audio`,
  review:(id,taskId,input)=>browserOnly?edit(id,p=>({...p,tasks:p.tasks.map(t=>t.id===taskId?reviewTask(t,input):t),favorite:input.favorite?taskId:p.favorite===taskId?null:p.favorite,updatedAt:new Date().toISOString()})):api(`/projects/${id}/tasks/${taskId}/review`,'POST',input),
};
