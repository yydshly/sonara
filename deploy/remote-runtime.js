/* Installed only in the published preview, before any application modules. */
(() => {
  const config=globalThis.SONARA_DEPLOYMENT;
  const base=config.basePath;
  const nativeFetch=globalThis.fetch.bind(globalThis);
  function localPath(value){const url=new URL(value,location.href);if(url.origin!==location.origin)return null;return base&&url.pathname.startsWith(base+'/')?url.pathname.slice(base.length):url.pathname;}
  globalThis.SONARA_ASSET=value=>{if(typeof value!=='string')return value;const path=localPath(value),mapped=config.assets[path];return mapped?base+mapped:value;};
  globalThis.fetch=async(input,options={})=>{
    const path=localPath(input instanceof Request?input.url:String(input));
    if(path?.startsWith('/api/')){
      const method=(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();
      if(!['GET','HEAD'].includes(method))return new Response(JSON.stringify({error:'远端展示版不执行后台创作或保存。已有作品可试听；新创作与重新演唱请使用本机工作台。'}),{status:503,headers:{'Content-Type':'application/json'}});
      if(Object.hasOwn(config.snapshots,path))return new Response(JSON.stringify(config.snapshots[path]),{headers:{'Content-Type':'application/json'}});
      if(config.assets[path])return nativeFetch(base+config.assets[path],options);
      return new Response(JSON.stringify({error:'这份本机记录未包含在本次公开示范中。'}),{status:404,headers:{'Content-Type':'application/json'}});
    }
    return nativeFetch(typeof input==='string'?globalThis.SONARA_ASSET(input):input,options);
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const bar=document.createElement('aside');bar.className='remote-notice';bar.setAttribute('aria-label','远端部署能力');
    const home=document.createElement('a');home.href=base+'/';home.textContent='声间 · 统一入口 ↗';
    const copy=document.createElement('span');copy.textContent='在线工作台 · 可保存想法、编辑歌词、交接 MiniMax 任务与导入音乐；自动生成需本机服务。公开示范使用 MP3 试听副本。';
    bar.append(home,copy);document.body.prepend(bar);
    const style=document.createElement('style');style.textContent='.remote-notice{display:flex;gap:20px;align-items:center;background:#24351d;border-bottom:1px solid #567044;padding:12px 24px;font:12px/1.8 system-ui;color:#d4e8bd}.remote-notice a{color:inherit;white-space:nowrap;text-decoration:underline}@media(max-width:650px){.remote-notice{display:block;padding:10px 18px}.remote-notice span{display:block;margin-top:4px}}';document.head.append(style);
    document.addEventListener('click',event=>{const link=event.target.closest?.('a[download]');if(link&&new URL(link.href).pathname.endsWith('.mp3'))link.download=link.download.replace(/\.wav$/i,'.mp3');},true);
    const locked='#save-direction,#prepare-project,#render-project,[data-choice],[data-ref="clear"],#project-panel-goal textarea,#project-panel-sections input,#project-panel-sections textarea,#project-panel-sections select,#project-panel-sections button[type="submit"]';
    const sync=()=>{
      for(const element of document.querySelectorAll(locked))if(!element.disabled){element.disabled=true;element.title='远端仅展示已保存内容；修改需本机工作台';}
      // Also handle property assignments on queried elements and HTML templates.
      // Only the explicit reviewed asset map can change a URL.
      for(const element of document.querySelectorAll('a[href],audio[src],source[src]')){
        const attribute=element.tagName==='A'?'href':'src';
        const value=element.getAttribute(attribute),mapped=globalThis.SONARA_ASSET(value);
        if(mapped!==value)element.setAttribute(attribute,mapped);
      }
    };
    sync();new MutationObserver(sync).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','href','src']});
  });
})();
