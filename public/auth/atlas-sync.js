(()=>{
 const iframe=document.getElementById('avand-atlas-background');
 if(!iframe)return;
 let last=null;
 const sync=()=>{
  const app=document.querySelector('#root .app');
  const dark=app?app.classList.contains('dark'):document.documentElement.dataset.theme==='dark';
  const theme=dark?'dark':'light';
  document.documentElement.dataset.theme=theme;
  document.documentElement.style.background=dark?'#0c0d11':'#faf9f6';
  if(theme===last)return;
  last=theme;
  try{iframe.contentWindow.postMessage({type:'AVAND_ATLAS_THEME',theme},location.origin);parent.postMessage({type:'AVAND_AUTH_THEME',theme},location.origin);}catch(e){}
 };
 iframe.addEventListener('load',()=>{last=null;sync();});
 const observer=new MutationObserver(sync);
 observer.observe(document.getElementById('root'),{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
 sync();
})();
