import {initStyleDiscovery} from './style-discovery.mjs';
const anchor=document.createElement('section');anchor.className='style-discovery';anchor.id='music-directions';anchor.setAttribute('aria-label','不同风格的试听');
const main=document.querySelector('main');if(main){main.prepend(anchor);initStyleDiscovery(anchor);}
