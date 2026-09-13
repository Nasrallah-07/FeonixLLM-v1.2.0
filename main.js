const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } = require('electron');
const path = require('path'), fs = require('fs'), http = require('http');
const { exec, spawn } = require('child_process');

const PORT = 8520;
let win = null, tray = null, quitting = false;
const ICON = path.join(__dirname, 'build', 'icon.png');
const WS_DIR = path.join(app.getPath('userData'), 'workspace');
const AUDIT = path.join(app.getPath('userData'), 'audit.jsonl');
const CFG = path.join(app.getPath('userData'), 'config.json');
const SYNC_FILE = path.join(app.getPath('userData'), 'sync.json');
const OLLAMA = 'http://127.0.0.1:11434';

fs.mkdirSync(WS_DIR, { recursive: true });

/* ═══════════ CONFIG ═══════════ */
function defaultCfg(){
  return {
    requireApproval: false,
    limits: { shellTimeoutMs: 15000, pythonTimeoutMs: 30000, maxOutput: 200000 },
    whitelist: ['dir','ls','type','cat','echo','node','python','py','pip','git','ollama','whoami','cd','curl'],
    denylist: true
  };
}
function cfgGet(){ try{ return Object.assign(defaultCfg(), JSON.parse(fs.readFileSync(CFG,'utf8'))); }catch(e){ return defaultCfg(); } }
function cfgSet(o){ fs.writeFileSync(CFG, JSON.stringify(o,null,2)); }
if (!fs.existsSync(CFG)) cfgSet(defaultCfg());

/* ═══════════ AUDIT LOG (kola call m-sjjel) ═══════════ */
function audit(entry){
  try { fs.appendFileSync(AUDIT, JSON.stringify(Object.assign({ ts: Date.now() }, entry)) + '\n'); } catch(e){}
}

/* ═══════════ SECURITY LAYER (server-side — machi ghir l'UI) ═══════════ */
/* Denylist: destructive patterns — kayt-rejectaw 7ta ila l'UI qlat "allow" */
const DENY_PATTERNS = [
  /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)/i, /rmdir\s+\/s/i,
  /del\s+\/[fsq]/i, /erase\s+\/[fs]/i,
  /format\s+[a-z]:/i, /diskpart/i, /mkfs/i, /dd\s+if=/i,
  /shutdown|restart-computer|stop-computer/i,
  /reg\s+(delete|add|import)/i,
  /remove-item\s+[^|]*-recurse/i,
  /:\(\)\s*\{.*\};\s*:/,                    /* fork bomb */
  /(curl|wget)[^|]*\|\s*(ba)?sh/i,          /* pipe to shell */
  /powershell[^\n]*-enc\b/i,                /* encoded commands */
  /\bvssadmin\s+delete/i, /bcdedit/i,
  /\bchmod\s+777\s+\//i, /\bchown\s+-R\s+\//i
];
function isDenied(str){
  return DENY_PATTERNS.some(re => re.test(String(str||'')));
}
/* Path sandbox: kola path khass yb9a dakhel WS_DIR — bla .. traversal */
function sandboxPath(p){
  if (!p || /[]/.test(String(p))) return null;
  const root = path.resolve(WS_DIR);
  const resolved = path.resolve(root, String(p));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}
/* Informed approval: l'user kaychof L'CODE/COMMAND EXACT machi "Allow?" ghir */
function approve(actionLabel, detail){
  const cfg = cfgGet();
  if (!cfg.requireApproval) return true;
  const opts = {
    type: 'warning',
    buttons: ['ALLOW', 'DENY'],
    defaultId: 1, cancelId: 1,
    title: 'FeonixLLM — Approval required',
    message: actionLabel,
    detail: String(detail||'').slice(0, 1800) +
      (String(detail||'').length > 1800 ? '\n\n… (truncated)' : '') +
      '\n\nThis will run on YOUR machine inside the sandboxed workspace.',
    noLink: true
  };
  const r = win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts);
  return r === 0;
}
/* exec m3a hard timeout + output cap (enforced here, machi f l'UI) */
function execLimited(cmd, opts, cb){
  const lim = cfgGet().limits;
  const t0 = Date.now();
  const child = exec(cmd, {
    cwd: WS_DIR, timeout: lim.shellTimeoutMs,
    maxBuffer: lim.maxOutput, windowsHide: true, ...opts
  }, (err, stdout, stderr) => {
    cb(err, stdout, stderr, Date.now() - t0);
  });
  return child;
}

/* ═══════════ SKILLS ═══════════ */
function skillShell(a, res){
  const cmd = String(a.cmd||a.command||'').trim();
  const cfg = cfgGet();
  if (!cmd) return json(res,400,{error:'cmd required'});
  const first = cmd.split(/\s+/)[0].toLowerCase();
  if (cfg.whitelist && !cfg.whitelist.includes(first)){
    audit({type:'shell', ok:false, cmd, reason:'whitelist: "'+first+'" not allowed'});
    return json(res,403,{error:'"'+first+'" is not in the command whitelist', whitelist:cfg.whitelist});
  }
  if (cfg.denylist && isDenied(cmd)){
    audit({type:'shell', ok:false, cmd, reason:'denylist pattern'});
    return json(res,403,{error:'BLOCKED by security denylist (destructive pattern detected)'});
  }
  if (!approve('Run this SHELL command?', cmd)){
    audit({type:'shell', ok:false, cmd, reason:'denied by user'});
    return json(res,403,{approved:false});
  }
  execLimited(cmd, {}, (err, stdout, stderr, ms) => {
    const code = err ? (err.code || 1) : 0;
    const killed = !!(err && err.killed);
    audit({type:'shell', ok:!err, cmd, exitCode:code, ms,
      out:(String(stdout||'').slice(0,300))});
    json(res,200,{
      approved:true, code, timedOut:killed, ms,
      stdout:String(stdout||'').slice(0,20000),
      stderr:String(stderr||'').slice(0,4000),
      error: killed ? 'timeout: command exceeded the time limit' : undefined
    });
  });
}
function skillPython(a, res){
  const code = String(a.code||'');
  const cfg = cfgGet();
  if (!code.trim()) return json(res,400,{error:'code required'});
  if (cfg.denylist && isDenied(code)){
    audit({type:'python', ok:false, code, reason:'denylist pattern'});
    return json(res,403,{error:'BLOCKED by security denylist (destructive pattern detected)'});
  }
  if (!approve('Run this PYTHON code?', code)){
    audit({type:'python', ok:false, code, reason:'denied by user'});
    return json(res,403,{approved:false});
  }
  const f = sandboxPath('_feonix_tmp_'+Date.now()+'.py');
  if (!f) return json(res,403,{error:'bad path'});
  fs.writeFileSync(f, code);
  const lim = cfgGet().limits;
  const exe = a.exe || 'python';
  const t0 = Date.now();
  const child = spawn(exe, [f], { cwd: WS_DIR, windowsHide: true });
  let so='', se='', done=false;
  const to = setTimeout(()=>{
    if (!done){ done=true; try{child.kill()}catch(e){}
      audit({type:'python', ok:false, code, reason:'timeout'});
      try{fs.unlinkSync(f)}catch(e){}
      json(res,200,{approved:true, timedOut:true,
        error:'timeout: python exceeded '+lim.pythonTimeoutMs+'ms and was killed'});
    }
  }, lim.pythonTimeoutMs);
  child.stdout.on('data',d=>{ if(so.length<lim.maxOutput) so+=d; });
  child.stderr.on('data',d=>{ if(se.length<lim.maxOutput) se+=d; });
  child.on('error', e => {
    if(done) return; done=true; clearTimeout(to);
    try{fs.unlinkSync(f)}catch(e2){}
    audit({type:'python', ok:false, code, error:e.message});
    json(res,200,{approved:true, error:'python not found — install it and check "Add to PATH": '+e.message});
  });
  child.on('close', code2 => {
    if(done) return; done=true; clearTimeout(to);
    try{fs.unlinkSync(f)}catch(e){}
    audit({type:'python', ok:code2===0, code, exitCode:code2, ms:Date.now()-t0,
      out:String(so||'').slice(0,300)});
    json(res,200,{approved:true, code:code2, ms:Date.now()-t0,
      stdout:String(so).slice(0,20000), stderr:String(se).slice(0,4000)});
  });
}
function skillFile(a, res){
  const op = a.op || a.action;
  if (op === 'list') {
    const dir = sandboxPath(a.path||'.');
    if(!dir) { audit({type:'file:list', ok:false, path:a.path, reason:'escape'}); return json(res,403,{error:'path escapes the sandboxed workspace'}); }
    try { json(res,200,{entries:fs.readdirSync(dir).map(n=>{
      const st = fs.statSync(path.join(dir,n));
      return {name:n, dir:st.isDirectory(), size:st.size}; })}); }
    catch(e){ json(res,400,{error:e.message}); }
  } else if (op === 'read') {
    const f = sandboxPath(a.path);
    if(!f) { audit({type:'file:read', ok:false, path:a.path, reason:'escape'}); return json(res,403,{error:'path escapes the sandboxed workspace (".." and outside paths are blocked)'}); }
    try { const t = fs.readFileSync(f,'utf8');
      audit({type:'file:read', ok:true, path:a.path});
      json(res,200,{content:t.slice(0,60000)}); }
    catch(e){ json(res,400,{error:e.message}); }
  } else if (op === 'write') {
    const f = sandboxPath(a.path);
    if(!f) { audit({type:'file:write', ok:false, path:a.path, reason:'escape'}); return json(res,403,{error:'path escapes the sandboxed workspace (".." and outside paths are blocked)'}); }
    const prev = fs.existsSync(f) ? fs.readFileSync(f,'utf8') : null;
    if (!approve('WRITE this file'+(prev?' (OVERWRITE)':'')+'?', 'Path: '+a.path+
      '\n\n--- NEW CONTENT ---\n'+String(a.content||'').slice(0,1200)+
      (prev!==null ? '\n\n--- OLD CONTENT (first 400 chars) ---\n'+prev.slice(0,400) : ''))){
      audit({type:'file:write', ok:false, path:a.path, reason:'denied by user'});
      return json(res,403,{approved:false});
    }
    try { fs.writeFileSync(f, String(a.content||''));
      audit({type:'file:write', ok:true, path:a.path, bytes:Buffer.byteLength(String(a.content||''))});
      json(res,200,{ok:true, bytes:Buffer.byteLength(String(a.content||''))}); }
    catch(e){ json(res,400,{error:e.message}); }
  } else json(res,400,{error:'op must be read|write|list'});
}
/* ═══════════ MCP CLIENT (stdio JSON-RPC spawn) ═══════════ */
const MCP_CACHE = {}; // name -> {proc, buf, tools, nextId, ready}
function mcpSpawn(cfgSrv){
  return new Promise((resolve,reject)=>{
    const key=cfgSrv.name;
    if(MCP_CACHE[key] && MCP_CACHE[key].ready) return resolve(MCP_CACHE[key]);
    if(MCP_CACHE[key] && MCP_CACHE[key].proc && !MCP_CACHE[key].dead) return resolve(MCP_CACHE[key]); // starting
    const parts=String(cfgSrv.cmd).split(/\s+/).concat(String(cfgSrv.args||'').split(/\s+/).filter(Boolean));
    const proc=spawn(parts[0],parts.slice(1),{cwd:WS_DIR,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const st={proc,buf:'',tools:[],nextId:1,ready:false,dead:false};
    MCP_CACHE[key]=st;
    let started=false;
    const to=setTimeout(()=>{ if(!started){ st.dead=true; try{proc.kill()}catch(e){}
      reject(new Error('MCP server "'+key+'" did not initialize (timeout 30s)')); } },30000);
    proc.stdout.on('data',d=>{
      st.buf+=d; let nl;
      while((nl=st.buf.indexOf('\n'))>=0){
        const line=st.buf.slice(0,nl).trim(); st.buf=st.buf.slice(nl+1);
        if(!line) continue;
        let msg; try{ msg=JSON.parse(line); }catch(e){ continue; }
        if(msg.id===1){ // initialize response
          started=true; clearTimeout(to); st.ready=true;
          // tools/list
          const id2=st.nextId++;
          proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:id2,method:'tools/list'})+'\n');
          st.pendingTools=id2;
        } else if(msg.id===st.pendingTools){
          st.tools=(msg.result&&msg.result.tools)||[];
          audit({type:'mcp', ok:true, server:key, action:'tools/list', count:st.tools.length});
          resolve(st);
        } else if(st.pending && msg.id===st.pending.id){
          st.pending.cb(msg);
        }
      }
    });
    proc.stderr.on('data',d=>{ audit({type:'mcp', ok:false, server:key, stderr:String(d).slice(0,200)}); });
    proc.on('error',e=>{ st.dead=true; clearTimeout(to); delete MCP_CACHE[key];
      if(!started) reject(new Error('MCP spawn failed: '+e.message)); });
    proc.on('close',()=>{ st.dead=true; delete MCP_CACHE[key]; });
    // initialize handshake
    proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{
      protocolVersion:'2024-11-05',
      capabilities:{},
      clientInfo:{name:'FeonixLLM',version:'1.5'}
    }})+'\n');
  });
}
function mcpCall(serverName,tool,args){
  return mcpSpawn(serverName).then(st=>new Promise((res,rej)=>{
    const found=st.tools.find(t=>t.name===tool);
    if(!found) return rej(new Error('tool "'+tool+'" not found on server "'+serverName+'" (available: '+st.tools.map(t=>t.name).join(', ')+')'));
    const id=st.nextId++; const to=setTimeout(()=>{
      rej(new Error('MCP tool call timeout (60s)'));
    },60000);
    st.pending={id,cb:m=>{
      clearTimeout(to);
      if(m.error) return rej(new Error(m.error.message||'MCP error'));
      res(m.result);
    }};
    st.proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',
      params:{name:tool,arguments:args||{}}})+'\n');
  }));
}
/* ═══════════ HTTP HELPERS ═══════════ */
function json(res, code, obj){
  res.writeHead(code, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cap){ return new Promise(res => {
  let b='', size=0; const max = cap||5e6;
  req.on('data',c=>{ size+=c.length; if(size>max){res({}); req.destroy();} else b+=c; });
  req.on('end',()=>{ try{res(JSON.parse(b||'{}'))}catch(e){res({})} }); });}
function proxyOllama(req,res,upPath){
  const creq = http.request(OLLAMA+upPath, { method:req.method,
    headers:{'Content-Type':'application/json'} }, cres => {
    res.writeHead(cres.statusCode, { 'Content-Type': cres.headers['content-type']||'application/json',
      'Access-Control-Allow-Origin':'*' });
    cres.pipe(res); });
  req.pipe(creq);
  creq.on('error', e => json(res,502,{error:e.message}));
}

/* ═══════════ API SERVER ═══════════ */
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, {
    'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type,Authorization'}); return res.end(); }
  try {
    if (p === '/ping') return json(res,200,{ ok:true, app:'feonixllm', version:'1.5-secure',
      workspace:WS_DIR, audit:AUDIT,
      security:{ sandbox:'restricted-subprocess', timeout:true, outputCap:true,
        denylist:true, pathSandbox:true, informedApproval:true, auditLog:true },
      capabilities:['chat','shell','python','file','webhook','logs'] });
    if (p === '/' || p === '/index.html') {
      res.writeHead(200,{'Content-Type':'text/html'});
      return res.end(fs.readFileSync(path.join(__dirname,'app','index.html')));
    }
    if (p === '/native.js') {
      res.writeHead(200,{'Content-Type':'text/javascript'});
      return res.end(fs.readFileSync(path.join(__dirname,'app','native.js')));
    }
	if (p === '/manifest.json') {
      res.writeHead(200,{'Content-Type':'application/manifest+json'});
      return res.end(fs.readFileSync(path.join(__dirname,'app','manifest.json')));
    }
    if (p === '/sw.js') {
      res.writeHead(200,{'Content-Type':'text/javascript','Service-Worker-Allowed':'/'});
      return res.end(fs.readFileSync(path.join(__dirname,'sw.js')));
    }
    if (p === '/icon.png') {
      res.writeHead(200,{'Content-Type':'image/png'});
      return res.end(fs.readFileSync(path.join(__dirname,'app','icon.png')));
    }
    if (p === '/v1/models') {
      http.get(OLLAMA+'/api/tags', cres => { let b='';
        cres.on('data',c=>b+=c); cres.on('end',()=>{
          try{ const j=JSON.parse(b);
            return json(res,200,{object:'list',data:(j.models||[]).map(m=>({id:m.name,object:'model',owned_by:'ollama'}))});
          }catch(e){ json(res,502,{error:'bad ollama'}); } }); })
        .on('error', e=>json(res,502,{error:e.message}));
      return; }
    if (p === '/v1/chat/completions' && req.method === 'POST') {
      const body = await readBody(req);
      const out = http.request(OLLAMA+'/api/chat', { method:'POST',
        headers:{'Content-Type':'application/json'} }, cres => {
        let buf='';
        if (body.stream) {
          res.writeHead(200,{'Content-Type':'text/event-stream','Access-Control-Allow-Origin':'*'});
          cres.on('data', c => { buf+=c; let nl;
            while((nl=buf.indexOf('\n'))>=0){ const line=buf.slice(0,nl).trim(); buf=buf.slice(nl+1);
              if(!line) continue;
              try{ const j=JSON.parse(line);
                const chunk={id:'feonix',object:'chat.completion.chunk',
                  choices:[{delta:{content:(j.message&&j.message.content)||''},finish_reason:j.done?'stop':null}]};
                res.write('data: '+JSON.stringify(chunk)+'\n\n');
                if(j.done) res.write('data: [DONE]\n\n');
              }catch(e){} } });
          cres.on('end',()=>res.end());
        } else {
          cres.on('data',c=>buf+=c);
          cres.on('end',()=>{ try{ const j=JSON.parse(buf);
            audit({type:'api-chat', model:body.model});
            json(res,200,{id:'feonix',object:'chat.completion',
              choices:[{message:{role:'assistant',content:(j.message&&j.message.content)||''},
                finish_reason:'stop'}],
              usage:{total_tokens:j.eval_count||0}});
          }catch(e){ json(res,502,{error:'ollama error'}); } });
        } });
      out.on('error', e=>json(res,502,{error:e.message}));
      out.end(JSON.stringify({model:body.model, messages:body.messages, stream:false}));
      return; }
    if (p.startsWith('/api/')) return proxyOllama(req,res,p);
    else if (p === '/feonix/skill/shell' && req.method==='POST') return skillShell(await readBody(req), res);
    else if (p === '/feonix/skill/python' && req.method==='POST') return skillPython(await readBody(req), res);
    
    else if (p === '/feonix/mcp/call' && req.method==='POST') {
      const b = await readBody(req);
      if(!b.server||!b.tool) return json(res,400,{error:'server + tool required'});
      const cfgSrv=(cfgGet().mcp||[]).find(m=>m.name===b.server);
      if(!cfgSrv) return json(res,404,{error:'MCP server "'+b.server+'" not configured'});
      if(!approve('Call MCP server tool?', 'Server: '+b.server+'\nTool: '+b.tool+
        '\nArgs: '+JSON.stringify(b.args||{}).slice(0,600))){
        audit({type:'mcp', ok:false, server:b.server, tool:b.tool, reason:'denied'});
        return json(res,403,{approved:false});
      }
      mcpCall(b.server,b.tool,b.args||{}).then(result=>{
        audit({type:'mcp', ok:true, server:b.server, tool:b.tool});
        const txt = result && result.content
          ? result.content.map(c=>c.text||JSON.stringify(c)).join('\n')
          : JSON.stringify(result);
        json(res,200,{ok:true, server:b.server, tool:b.tool, output:String(txt).slice(0,20000)});
      }).catch(e=>{
        audit({type:'mcp', ok:false, server:b.server, tool:b.tool, error:e.message});
        json(res,500,{error:e.message});
      });
      return; }
    else if (p === '/feonix/mcp/tools' && req.method==='GET') {
      const list=(cfgGet().mcp||[]);
      Promise.all(list.map(s=>mcpSpawn(s).then(st=>({server:s.name,tools:st.tools.map(t=>({name:t.name,description:t.description}))})).catch(e=>({server:s.name,tools:[],error:e.message}))))
        .then(all=>json(res,200,{servers:all}));
      return; }
    else if (p === '/feonix/sync/exchange' && req.method==='POST') {
      const b = await readBody(req);
      const incomingTs = typeof b.ts === 'number' ? b.ts : 0;
      let stored = {ts:0, state:null};
      try { stored = JSON.parse(fs.readFileSync(SYNC_FILE,'utf8')); } catch(e){}
      if (incomingTs > (stored.ts||0)) {
        try { fs.writeFileSync(SYNC_FILE, JSON.stringify({ts:incomingTs, state:b.state})); } catch(e){}
        audit({type:'sync', direction:'received', ts:incomingTs});
        return json(res,200,{winner:'you', ts:incomingTs});
      } else if ((stored.ts||0) > incomingTs) {
        audit({type:'sync', direction:'sent', ts:stored.ts});
        return json(res,200,{winner:'server', ts:stored.ts, state:stored.state});
      } else {
        return json(res,200,{winner:'tie', ts:incomingTs});
      }
    }
    else if (p === '/feonix/agent/trigger' && req.method==='POST') {
      const b = await readBody(req);
      if (!b.prompt) return json(res,400,{error:'prompt required'});
      const model = b.model || cfgGet().defaultModel || 'llama3';
      const body = JSON.stringify({ model, stream:false,
        messages:[{role:'system',content:b.system||'You are a helpful assistant.'},{role:'user',content:b.prompt}] });
      const r = http.request(OLLAMA+'/api/chat',{method:'POST',
        headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},cres=>{
        let buf=''; cres.on('data',c=>buf+=c);
        cres.on('end',()=>{ try{ const j=JSON.parse(buf);
          audit({type:'webhook', ok:true, model});
          json(res,200,{model, output:(j.message&&j.message.content)||''});
        }catch(e){ audit({type:'webhook', ok:false}); json(res,502,{error:'ollama error'}); } }); });
      r.on('error', e=>json(res,502,{error:e.message}));
      r.write(body); r.end();
      return; }
    else if (p === '/feonix/logs' || p === '/feonix/audit') {
      try { const lines = fs.readFileSync(AUDIT,'utf8').trim().split('\n').slice(-200);
        return json(res,200,{entries:lines.map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)}); }
      catch(e){ return json(res,200,{entries:[]}); } }
    else if (p === '/feonix/config' && req.method==='POST') {
      const b = await readBody(req); const c = Object.assign(cfgGet(), b);
      cfgSet(c); return json(res,200,{ok:true,config:c}); }
    else if (p === '/feonix/mcp/save' && req.method==='POST') {
      const b = await readBody(req);
      cfgGet().mcp = b.servers||[]; cfgSet(cfgGet());
      Object.keys(MCP_CACHE).forEach(k=>{ try{MCP_CACHE[k].proc.kill()}catch(e){} delete MCP_CACHE[k]; });
      return json(res,200,{ok:true}); }
    else if (p === '/feonix/config') return json(res,200,cfgGet());
    else { res.writeHead(404,{'Access-Control-Allow-Origin':'*'}); return res.end('not found'); }
  } catch(e){ json(res,500,{error:e.message}); }
});

/* ═══════════ WINDOW / TRAY ═══════════ */
function createWindow(){
  win = new BrowserWindow({ width:1320, height:880, minWidth:920, minHeight:600,
    backgroundColor:'#FAF9F5', title:'FeonixLLM',
    icon: fs.existsSync(ICON)?ICON:undefined, autoHideMenuBar:true,
    webPreferences:{ contextIsolation:true, nodeIntegration:false, webSecurity:false }, show:false });
  win.once('ready-to-show',()=>win.show());
  win.webContents.on('before-input-event',(e,input)=>{
    if(input.control && input.shift && input.key.toLowerCase()==='i'){e.preventDefault();win.webContents.toggleDevTools()}
  });
  
  win.loadURL('http://127.0.0.1:'+PORT);
  win.webContents.setWindowOpenHandler(({url})=>{ if(/^https?:/i.test(url)) shell.openExternal(url); return {action:'deny'}; });
  win.on('close', e => { if(!quitting && tray){ e.preventDefault(); win.hide(); } });
  win.on('closed', ()=>win=null);
}
function makeTray(){
  if(!fs.existsSync(ICON)) return;
  const img = nativeImage.createFromPath(ICON).resize({width:16,height:16});
  tray = new Tray(img); tray.setToolTip('FeonixLLM');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Open FeonixLLM', click:()=>{win.show();win.focus();}},
    {type:'separator'},
    {label:'Open workspace folder', click:()=>shell.openPath(WS_DIR)},
    {label:'Open audit log', click:()=>shell.openPath(AUDIT)},
    {type:'separator'},
    {label:'Quit', click:()=>{quitting=true;app.quit();}}]));
  tray.on('double-click',()=>{win.show();win.focus();});
}
async function ensureOllama(){
  try{ const r = await fetch(OLLAMA+'/api/tags',{signal:AbortSignal.timeout(1500)}); if(r.ok) return; }catch(e){}
  try{ const c = spawn('ollama',['serve'],{detached:true,stdio:'ignore'}); c.unref(); }catch(e){}
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit(); else {
  app.setAppUserModelId('com.feonixllm.app');
  app.on('second-instance',()=>{ if(win){win.show();win.focus();} });
  app.whenReady().then(async ()=>{
    Menu.setApplicationMenu(null);
    server.listen(PORT,'127.0.0.1',()=>console.log('FeonixLLM API → http://127.0.0.1:'+PORT+' (sandboxed)'));
    await ensureOllama();
    createWindow(); makeTray();
  });
  app.on('before-quit',()=>quitting=true);
  app.on('window-all-closed',()=>app.quit());
  app.on('activate',()=>{ if(win){win.show();win.focus();} });
}