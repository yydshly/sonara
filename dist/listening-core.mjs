// Count distinct played intervals; seeking and replaying the same second add no credit.
export function addPlayedInterval(ranges,start,end,duration){
  if(![start,end,duration].every(Number.isFinite)||start<0||end<=start||end>duration||end-start>1.5)return ranges;
  const all=[...ranges,[start,end]].sort((a,b)=>a[0]-b[0]),out=[];
  for(const r of all){const last=out.at(-1);if(last&&r[0]<=last[1]+.02)last[1]=Math.max(last[1],r[1]);else out.push([...r]);}return out;
}
export const playedSeconds=ranges=>ranges.reduce((sum,[a,b])=>sum+b-a,0);
export const choiceLabels={A:'A 更有感觉',B:'B 更有感觉',neither:'都不满意',same:'差不多',clear:'已撤回'};
export function describeChoice(record,trial){
  if(trial.factor==='lyric-phrasing'){
    if(!record||record.choice==='clear')return '尚未保存本轮判断。修改版是否更自然，需要你试听后决定。';
    if(record.choice==='neither')return '已记下：两版都不满意。词曲与演唱自然度仍未过关。';
    if(record.choice==='same')return '已记下：没有听出明显改善。这次修改还没有解决你的问题。';
    return `本轮你认为${record.choice==='B'?'修改版':'原版'}更自然。这是对这段表达的判断，不会转成音乐风格偏好。`;
  }
  if(!record||record.choice==='clear')return '还没有保存本轮偏好。舒服和共鸣的具体原因，先留作未知。';
  if(record.choice==='neither')return '已记下：两版都不满意。这次没有选定伴奏方向，下一轮需要继续排查演唱、词曲或编配。';
  if(record.choice==='same')return '已记下：两版差不多。这次没有形成伴奏层次偏好，可以继续比较别的因素。';
  return `本轮你选择了 ${record.choice}：${trial.variants.find(v=>v.id===record.choice).description}。这只说明本段的相对选择，喜欢的原因仍未确认。`;
}
