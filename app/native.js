/* FeonixLLM native bridge v4 — file outputs as downloadable artifact cards */
(function(){
  const API='http://127.0.0.1:8520';
  let NATIVE=false;

  fetch(API+'/ping').then(r=>r.json()).then(j=>{
    if(j&&j.ok){NATIVE=true;window.FEONIX_NATIVE=j;
      console.log('[feonix] native backend online');
      if(window.toast)toast('Native backend connected — shell/python/file skills ON','ok');
    }
  }).catch(()=>console.log('[feonix] native backend not detected (browser mode)'));

  async function callNative(p,b){
    const r=await fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
    return r.json();
  }

  const TOOL_RE=/```tool:([a-zA-Z_]+)([\s\S]*?)```/g;
  function parseArgs(raw){
    let s=String(raw||'').replace(/`+$/,'').trim();
    try{return JSON.parse(s)}catch(e){}
    const m=s.match(/\{[\s\S]*\}/);
    if(m){try{return JSON.parse(m[0])}catch(e){}}
    try{return JSON.parse(s.replace(/'/g,'"'))}catch(e){}
    return null;
  }
  function classify(tool,a){
    const t=(tool||'').toLowerCase();
    if(t==='skill')return ['shell','python','file','http'].includes(a.action)?a.action:null;
    if(t==='shell'||t==='bash'||t==='cmd')return 'shell';
    if(t==='python'||t==='py')return 'python';
    if(t==='file'||t==='fs'||t==='files')return 'file';
    if(t==='http'||t==='fetch'||t==='request'||t==='curl')return 'http';
    return null;
  }

  /* ─── FILE ARTIFACT CARD ─── */
  function fileCard(name,content,op){
    const ext=(name.split('.').pop()||'').toLowerCase();
    const isImg=['png','jpg','jpeg','gif','webp','svg'].includes(ext);
    const isHtml=ext==='html'||ext==='htm';
    const isMd=ext==='md'||ext==='markdown';
    const isCsv=ext==='csv';
    const isJson=ext==='json';
    const KB=Math.max(1,Math.round(content.length/102.4)/10);
    const ico=isImg?'image':isHtml?'code':isMd?'file-text':isJson?'braces':'file';
    const type=isImg?'Image':isHtml?'HTML page':isMd?'Markdown':isJson?'JSON':isCsv?'CSV':'Text file';

    const card=document.createElement('div');
    card.className='art-card';
    card.innerHTML=
      '<div class="art-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--panel2)">'+
      (isImg?'<img style="max-width:90%;max-height:90%;border-radius:8px">':
       isHtml?'<iframe sandbox="allow-scripts" style="width:900px;height:680px;border:none;transform:scale(.45);transform-origin:0 0"></iframe>':
       '<i data-lucide="'+ico+'" style="width:42px;height:42px;color:var(--accent)"></i>')+
      '</div>'+
      '<div class="art-info">'+
      '<span class="art-icon"><i data-lucide="'+ico+'"></i></span>'+
      '<span class="art-txt"><span class="art-title">'+esc(name)+'</span>'+
      '<span class="art-meta">'+type+' · '+KB+' KB · saved in workspace</span></span>'+
      '<span class="art-open"><i data-lucide="eye"></i>Open</span></div>';
    card.title='View & download';

    const thumb=card.querySelector('.art-thumb');
    if(isImg){const im=thumb.querySelector('img');
      const ext2=ext==='jpg'?'jpeg':ext;
      im.src='data:image/'+ext2+';base64,'+b64e(new TextEncoder().encode(content));}
    else if(isHtml)thumb.querySelector('iframe').srcdoc=content;

    card.onclick=()=>showFilePanel(name,content,op,isHtml);
    if(window.icons)window.icons();
    return card;
  }
  function b64e(u8){let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,Math.min(i+0x8000,u8.length)));return btoa(s)}

  /* ─── FILE VIEWER PANEL ─── */
  function showFilePanel(name,content,op,isHtml){
    const old=document.getElementById('fxFilePanel');
    if(old)old.remove();
    const ext=(name.split('.').pop()||'').toLowerCase();
    const isImg=['png','jpg','jpeg','gif','webp','svg'].includes(ext);
    const isCsv=ext==='csv';
    const panel=document.createElement('div');
    panel.id='fxFilePanel';
    panel.style.cssText='position:fixed;top:0;right:0;bottom:0;width:520px;max-width:92vw;z-index:48;background:var(--bg-side);border-left:1px solid var(--line);box-shadow:var(--shadow);display:flex;flex-direction:column';
    panel.innerHTML=
      '<div style="padding:13px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:9px">'+
      '<div style="font-family:var(--font-display);font-size:17px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(name)+'</div>'+
      '<button class="icon-btn" id="fxFpDl" title="Download"><i data-lucide="download"></i></button>'+
      '<button class="icon-btn" id="fxFpX" title="Close"><i data-lucide="x"></i></button></div>'+
      '<div id="fxFpBody" style="flex:1;overflow:auto;position:relative;background:#fff"></div>'+
      '<div style="padding:10px 14px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center">'+
      '<span style="font-size:11.5px;color:var(--ink3);flex:1">'+esc(op||'file')+' · workspace file</span>'+
      '<button class="btn primary" id="fxFpDl2"><i data-lucide="download"></i> Download</button></div>';
    document.body.appendChild(panel);
    if(window.icons)window.icons();

    const body=panel.querySelector('#fxFpBody');
    if(isImg){
      const ext2=ext==='jpg'?'jpeg':ext;
      body.innerHTML='<div style="display:grid;place-items:center;height:100%;background:var(--panel2)">'+
        '<img src="data:image/'+ext2+';base64,'+b64e(new TextEncoder().encode(content))+'" style="max-width:92%;max-height:92%;border-radius:12px;box-shadow:var(--shadow)"></div>';
    }else if(isHtml){
      const fr=document.createElement('iframe');
      fr.sandbox='allow-scripts';fr.style.cssText='width:100%;height:100%;border:none';
      fr.srcdoc=content;body.appendChild(fr);
    }else if(isCsv){
      const rows=content.split(/\r?\n/).slice(0,40).map(r=>r.split(','));
      let html='<table style="border-collapse:collapse;font-size:12.5px;width:100%">';
      rows.forEach((r,i)=>{html+='<tr>'+r.map(c=>'<'+(i===0?'th':'td')+' style="border:1px solid var(--line);padding:5px 9px;text-align:left;background:'+(i===0?'var(--panel2)':'var(--panel)')+'">'+esc(c.slice(0,60))+'</'+(i===0?'th':'td')+'>').join('')+'</tr>'});
      html+='</table>';
      body.innerHTML='<div style="padding:12px">'+html+'</div>';
    }else{
      body.innerHTML='<pre style="margin:0;padding:16px;font-family:var(--font-mono);font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:var(--ink)">'+esc(content.slice(0,50000))+'</pre>';
    }

    const dl=()=>{
      const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));
      a.download=name;a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),4000);
      if(window.toast)window.toast('Downloaded '+name,'ok');
    };
    panel.querySelector('#fxFpDl').onclick=dl;
    panel.querySelector('#fxFpDl2').onclick=dl;
    panel.querySelector('#fxFpX').onclick=()=>panel.remove();
  }

  /* ─── attach cards l messages ─── */
  window.FEONIX_SHOW_FILE=function(msgEl,name,content,op){
    try{
      const body=msgEl.querySelector('.m-body');
      if(!body)return;
      body.appendChild(fileCard(name,content,op));
    }catch(e){console.log('[feonix] card attach failed',e)}
  };

  function wrapExec(){
    if(typeof window.execTools!=='function'||window.execTools.__feonix){setTimeout(wrapExec,50);return}
    const _orig=window.execTools;
    window.execTools=async function(msg){
      if(msg.toolsExecuted)return;
      msg.toolsExecuted=true;
      TOOL_RE.lastIndex=0;
      let m,results=[],nativeUsed=false,files=[];const leftover=[];
      while((m=TOOL_RE.exec(msg.content))!==null){
        const tool=m[1],raw=m[2];
        const a=parseArgs(raw);
        if(!a)continue;
        const kind=classify(tool,a);
        if(NATIVE&&kind){
          nativeUsed=true;
          if(kind==='file'&&!a.op)a.op=a.action;
          if(kind==='shell'&&!a.cmd)a.cmd=a.command||a.code;
          let ok=true,txt='';
          try{
            if(kind==='shell'){
              const r=await callNative('/feonix/skill/shell',{cmd:a.cmd});
              ok=r.approved!==false&&!r.error;
              txt=r.error?('❌ '+r.error):('🖥️ shell output:\n'+(r.stdout||'(empty)')+(r.stderr?('\n[stderr] '+r.stderr):''));
            }else if(kind==='python'){
              const r=await callNative('/feonix/skill/python',{code:a.code});
              ok=r.approved!==false;
              txt=r.error?('❌ '+r.error):('🐍 python output:\n'+(r.stdout||'(no output)')+(r.stderr?('\n[stderr] '+r.stderr):''));
            }else if(kind==='file'){
              const r=await callNative('/feonix/skill/file',a);
              ok=!r.error&&r.approved!==false;
              txt=r.error?('❌ '+r.error):
                a.op==='read'?('📄 '+a.path+' read'):
                a.op==='write'?('✅ '+(a.path||'file')+' saved'):
                '📁 '+JSON.stringify(r.entries||[]);
              if(a.op==='write'&&ok){
                files.push({name:a.path||'file.txt',content:String(a.content||''),op:'write'});
              }
              if(a.op==='read'&&ok&&r.content){
                files.push({name:a.path||'file.txt',content:String(r.content),op:'read'});
              }
            }else if(kind==='http'){
              const r=await fetch(a.url,{method:a.method||'GET',headers:a.headers||{},body:a.body!==undefined?JSON.stringify(a.body):undefined});
              const t=await r.text();ok=r.status<400;
              txt='🌐 HTTP '+r.status+'\n'+t.slice(0,2000);
            }
          }catch(e){ok=false;txt='skill error: '+e.message}
          results.push({tool:kind,ok,msg:txt.slice(0,900)});
          console.log('[feonix] skill:',kind,ok);
        }else{
          leftover.push('\n```tool:'+tool+' '+JSON.stringify(a)+'```\n');
        }
      }
      let content=msg.content.replace(TOOL_RE,'').trim();
      if(leftover.length)content=(content?content+'\n\n':'')+leftover.join('\n');
      msg.content=content;
      if(!nativeUsed){
        msg.toolsExecuted=false;
        return _orig(msg);
      }
      if(files.length)msg.files=files;
      const copy=Object.assign({},msg,{toolsExecuted:false,tools:null});
      try{await _orig(copy)}catch(e){}
      msg.tools=results.concat(copy.tools||[]);
      msg.content=copy.content||msg.content;
      if(window.save)window.save();
      try{
        const el=document.querySelector('#msgList [data-mid="'+msg.id+'"]');
        if(el){(msg.files||[]).forEach(f=>window.FEONIX_SHOW_FILE(el,f.name,f.content,f.op))}
      }catch(e){}
    };
    window.execTools.__feonix=true;
  }
  wrapExec();

  /* cards kayt-3awdo f render dyal messages 9doma */
  const mo=new MutationObserver(()=>{
    if(!window.S)return;
    try{
      const conv=window.activeConv?window.activeConv():null;
      if(!conv)return;
      conv.messages.forEach(m=>{
        if(m.files&&m.files.length){
          const el=document.querySelector('#msgList [data-mid="'+m.id+'"]');
          if(el&&!el.dataset.fxfiles){
            el.dataset.fxfiles='1';
            m.files.forEach(f=>window.FEONIX_SHOW_FILE(el,f.name,f.content,f.op));
          }
        }
      });
    }catch(e){}
  });
  mo.observe(document.getElementById('msgList')||document.body,{childList:true,subtree:false});

  /* hint dyal l'model */
  if(typeof window.toolHint==='function'){
    const _th=window.toolHint;
    window.toolHint=function(){
      let h=_th();
      if(NATIVE){
        h+='\nNATIVE HOST TOOLS (execute automatically — user only clicks Allow):';
        h+='\n```tool:file {"action":"write","path":"hello.txt","content":"text here"}```';
        h+='\n```tool:file {"action":"read","path":"notes.txt"}```';
        h+='\n```tool:shell {"cmd":"dir"}```';
        h+='\n```tool:python {"code":"print(1+1)"}```';
        h+='\nRULES: to use a tool, reply with ONLY the tool block and STOP. The app executes it and sends results next turn. Written files appear as downloadable cards for the user. NEVER say "proposal".';
      }
      return h;
    };
  }
})();