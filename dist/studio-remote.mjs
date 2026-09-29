export function mountRemoteConnection({store,onChange}){
  const $=id=>document.getElementById(id);let state=null,pending=false,timer=null,addressList='';
  function render(remote){state=remote||{enabled:false,addresses:[]};$('remote-browser-note').hidden=!store.browserOnly;$('remote-controls').hidden=store.browserOnly;
    const select=$('remote-address'),old=select.value,nextList=JSON.stringify(state.addresses||[]);if(nextList!==addressList){addressList=nextList;select.replaceChildren();for(const item of state.addresses||[]){const o=document.createElement('option');o.value=item.address;o.textContent=`${item.name} · ${item.address}${item.virtual?'（虚拟网卡）':''}`;select.append(o);}if([...select.options].some(o=>o.value===old))select.value=old;}
    $('remote-state').textContent=state.message||'请在本机工作台开启连接';$('remote-state').dataset.online=String(!!state.online);
    $('remote-peer').textContent=state.worker?`${state.worker.name} · 最近联系 ${new Date(state.worker.lastSeen).toLocaleTimeString()}`:'还没有电脑配对';
    $('remote-endpoint').textContent=state.url||'开启后显示本机连接地址';$('remote-enable').disabled=pending||state.enabled||!select.options.length;select.disabled=pending||state.enabled;
    $('remote-disable').disabled=pending||!state.enabled;$('remote-package').hidden=!state.enabled;$('remote-address-note').hidden=!!select.options.length;
  }
  async function update(){if(store.browserOnly)return;const connection=await store.status();render(connection.remote);onChange(connection);}
  async function action(fn){if(pending)return;pending=true;render(state);$('remote-feedback').textContent='';try{await fn();await update();}catch(e){$('remote-feedback').textContent=e.message;}finally{pending=false;render(state);}}
  $('remote-enable').onclick=()=>action(()=>store.remoteEnable($('remote-address').value));
  $('remote-disable').onclick=()=>action(()=>store.remoteDisable());
  $('remote-package').href='/api/studio/remote/package';
  $('connections').addEventListener('close',()=>{clearTimeout(timer);timer=null;});
  async function poll(){if(!$('connections').open)return;try{await update();}catch{$('remote-feedback').textContent='暂时读不到连接状态，请检查本机服务。';}timer=setTimeout(poll,3000);}
  return {render,opened(){clearTimeout(timer);poll();}};
}
