import {ServiceError} from './generation-service.mjs';

// Optional for old projects; a submitted brief belongs to the immutable version.
export function validateCreativeBrief(value){
  if(value===undefined||value===null)return null;
  const keys=['audience','feelingStart','feelingEnd','keep'];
  if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new ServiceError('创作目标格式无效。');
  const result={};
  for(const key of keys){const text=value[key]??'';if(typeof text!=='string'||text.length>160)throw new ServiceError('每项情绪与创作目标请控制在 160 字以内。');result[key]=text.trim();}
  return Object.values(result).some(Boolean)?result:null;
}
