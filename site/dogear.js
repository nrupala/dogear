/* dogear reader v1.0.2 — Document in, place kept, resume anywhere.
   Owned by Nrupal Akolkar · Built with Muse by Meta · https://getdogear.app
   Self-contained embed: drop this file in a <script> tag (or inline it), then put
   <div data-dogear></div> where the reader should mount. Optional attributes:
     data-dogear-scope   CSS selector for the readable region (default: article)
     data-dogear-select  selectors for readable blocks (default: h1,h2,p,li)
     data-dogear-exclude selectors to skip (default: .dg,.share-row,.news-box,.crumbs,aside,.disclaimer,.meta,.refs,.related)
   SKINS: the chrome honors --dg-* CSS custom properties (set them on :root or the
   mount). The DEFAULT skin is Ether — the deep-listening skin (deep indigo,
   aquamarine sound-energy, soft off-white type). Override the tokens to re-skin,
   e.g. the phosphor-green Matrix skin (--dg-accent:#8dffb9; --dg-bg:#0a0f0c; …).
   No libraries, no autoplay, no tracking. Place is kept per article in localStorage. */
(function(){
'use strict';
var HOME='https://getdogear.app';

/* ---- brand CSS, injected once (identical dogear surface on every site) ---- */
var CSS=
'.dg{margin:.6rem 0 1.3rem;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:.85rem;line-height:1.5;color:var(--dg-ink,#e9f2f1);}'
+'.dg-row{display:flex;align-items:center;gap:.5rem .7rem;flex-wrap:wrap;background:var(--dg-bg,#081322);border:1px solid var(--dg-ring,rgba(111,242,220,.4));border-radius:12px;padding:.55rem .8rem;box-shadow:0 0 18px var(--dg-glow,rgba(111,242,220,.12));}'
+'.dg-play{font:inherit;font-weight:700;color:var(--dg-play-ink,#042a28);background:var(--dg-accent,#6ff2dc);border:0;border-radius:999px;padding:.45rem 1.1rem;cursor:pointer;}'
+'.dg-play:hover{filter:brightness(1.07);}'
+'.dg-play:focus-visible,.dg-stop:focus-visible,.dg-rate select:focus-visible{outline:2px solid var(--dg-accent,#6ff2dc);outline-offset:2px;}'
+'.dg-stop{font:inherit;color:var(--dg-accent,#6ff2dc);background:transparent;border:1px solid var(--dg-ring,rgba(111,242,220,.4));border-radius:999px;padding:.4rem .8rem;cursor:pointer;}'
+'.dg-stop:disabled{opacity:.35;cursor:default;}'
+'.dg-rate{display:inline-flex;align-items:center;gap:.35rem;color:var(--dg-accent,#6ff2dc);}'
+'.dg-rate select{font:inherit;color:var(--dg-ink,#e9f2f1);background:var(--dg-bg,#081322);border:1px solid var(--dg-ring,rgba(111,242,220,.4));border-radius:8px;padding:.3rem .4rem;}'
+'.dg-progress{flex:1 1 100%;height:4px;background:var(--dg-track,rgba(111,242,220,.15));border-radius:2px;overflow:hidden;}'
+'.dg-fill{display:block;height:100%;width:0;background:var(--dg-accent,#6ff2dc);transition:width .25s ease;}'
+'.dg-sub{display:flex;justify-content:space-between;gap:.6rem;margin-top:.45rem;font-size:.7rem;color:var(--dg-dim,rgba(190,225,220,.55));}'
+'.dg-sub a{color:var(--dg-accent,#6ff2dc);text-decoration:none;border-bottom:1px dotted var(--dg-ring,rgba(111,242,220,.4));}'
+'.dg-sent.dg-on{background:var(--dg-hi,rgba(111,242,220,.14));border-radius:3px;}'
+'@media (prefers-reduced-motion:reduce){.dg-fill{transition:none;}}';

/* ---- reader chrome ---- */
var ROW=
'<div class="dg-row">'
+'<button type="button" class="dg-play" aria-pressed="false">\u25B6 dogear</button>'
+'<button type="button" class="dg-stop" disabled aria-label="Stop reading">\u23F9</button>'
+'<label class="dg-rate">Speed <select class="dg-speed" aria-label="Reading speed">'
+'<option value="0.8">0.8\u00D7</option><option value="1" selected>1\u00D7</option>'
+'<option value="1.25">1.25\u00D7</option><option value="1.5">1.5\u00D7</option>'
+'</select></label>'
+'<div class="dg-progress" aria-hidden="true"><span class="dg-fill"></span></div>'
+'</div>'
+'<div class="dg-sub"><span>document in, place kept, resume anywhere</span>'
+'<a href="'+HOME+'" target="_blank" rel="noopener">getdogear.app</a></div>';

if(!document.querySelector('[data-dogear]'))return;
if(!document.querySelector('style[data-dogear-css]')){
  var st=document.createElement('style');
  st.setAttribute('data-dogear-css','1');
  st.textContent=CSS;
  document.head.appendChild(st);
}

var mounts=document.querySelectorAll('[data-dogear]');
Array.prototype.forEach.call(mounts,function(m){init(m);});

function init(mount){
  var scopeEl=mount.getAttribute('data-dogear-scope');
  var scope=scopeEl?document.querySelector(scopeEl):document.querySelector('article');
  if(!scope||!('speechSynthesis' in window)){mount.style.display='none';return;}
  mount.classList.add('dg');
  mount.innerHTML=ROW;
  var play=mount.querySelector('.dg-play'),
      stopBtn=mount.querySelector('.dg-stop'),
      rateSel=mount.querySelector('.dg-speed'),
      fill=mount.querySelector('.dg-fill');
  var synth=window.speechSynthesis;

  var select=mount.getAttribute('data-dogear-select')||'h1,h2,p,li';
  var excl=mount.getAttribute('data-dogear-exclude')||'.dg,.share-row,.news-box,.crumbs,aside,.disclaimer,.meta,.refs,.related';
  var blocks=[];
  Array.prototype.forEach.call(scope.querySelectorAll(select),function(el){
    if(el.closest(excl))return;
    if(el.textContent.replace(/\s+/g,''))blocks.push(el);
  });

  /* split into sentences, wrap for highlight */
  var sents=[];
  blocks.forEach(function(el){
    var walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null,false);
    var nodes=[],n;
    while((n=walker.nextNode())){if(n.nodeValue.replace(/\s+/g,''))nodes.push(n);}
    nodes.forEach(function(tn){
      var parts=tn.nodeValue.split(/(?<=[.!?])\s+/);
      var frag=document.createDocumentFragment();
      parts.forEach(function(p){
        if(!p.replace(/\s+/g,''))return;
        var sp=document.createElement('span');
        sp.className='dg-sent';
        sp.textContent=p;
        frag.appendChild(sp);
        frag.appendChild(document.createTextNode(' '));
        sents.push({el:sp,text:p.replace(/\s+/g,' ').trim()});
      });
      tn.parentNode.replaceChild(frag,tn);
    });
  });
  if(!sents.length){mount.style.display='none';return;}

  /* group sentences into ~240-char spoken chunks */
  var chunks=[];
  sents.forEach(function(s){
    var t=s.text;
    while(t.length>240){
      var c=t.lastIndexOf(',',240);
      if(c<80)c=t.lastIndexOf(' ',240);
      if(c<80)c=240;
      chunks.push({el:s.el,text:t.slice(0,c+1)});
      t=t.slice(c+1).replace(/^\s+/,'');
    }
    if(t)chunks.push({el:s.el,text:t});
  });

  /* voice: prefer an English voice, Google US English first */
  var voice=null;
  function pickVoice(){
    var vs=synth.getVoices();
    if(!vs||!vs.length)return;
    var en=vs.filter(function(v){return/^en/i.test(v.lang||'');});
    en.sort(function(a,b){
      var ga=/google/i.test(a.name||'')?0:1,gb=/google/i.test(b.name||'')?0:1;
      if(ga!==gb)return ga-gb;
      var ua=/en[-_]us/i.test(a.lang||'')?0:1,ub=/en[-_]us/i.test(b.lang||'')?0:1;
      return ua-ub;
    });
    voice=(en[0]||vs[0])||null;
  }
  try{if('onvoiceschanged' in synth)synth.onvoiceschanged=pickVoice;}catch(e){}
  pickVoice();

  /* place kept: per-article chunk index in localStorage */
  function pkey(){return 'dogear:place:'+location.pathname;}
  function loadPlace(){
    try{
      var p=JSON.parse(localStorage.getItem(pkey()));
      if(p&&typeof p.i==='number'&&p.i>0&&p.i<chunks.length&&p.n===chunks.length)return p;
    }catch(e){}
    return null;
  }
  function savePlace(i){
    try{localStorage.setItem(pkey(),JSON.stringify({i:i,n:chunks.length,t:Date.now()}));}catch(e){}
  }
  function clearPlace(){try{localStorage.removeItem(pkey());}catch(e){}}

  /* screen wake lock: the display must not time out mid-article */
  var wakeLock=null;
  function lock(){
    if(!('wakeLock' in navigator))return;
    try{navigator.wakeLock.request('screen').then(function(s){wakeLock=s;},function(){});}catch(e){}
  }
  function unlock(){
    if(wakeLock){try{wakeLock.release();}catch(e){}wakeLock=null;}
  }

  var state='idle',idx=0,gen=0,keepAlive=null;
  function clearHi(){
    var h=scope.querySelector('.dg-sent.dg-on');
    if(h)h.classList.remove('dg-on');
  }
  function progress(i){
    if(fill)fill.style.width=(i<0?0:Math.round(((i+1)/chunks.length)*100))+'%';
  }
  function setPlay(){
    if(state==='playing'){play.textContent='\u23F8 Pause';}
    else if(state==='paused'){play.textContent='\u25B6 Resume';}
    else{
      var p=loadPlace();
      play.textContent=p?('\u25B6 Resume \u00B7 '+Math.round((p.i/chunks.length)*100)+'%'):'\u25B6 dogear';
    }
    play.setAttribute('aria-pressed',state==='playing'?'true':'false');
    stopBtn.disabled=(state==='idle');
  }
  /* Android Chrome suspends long utterances: nudge it awake */
  function disarm(){if(keepAlive){clearInterval(keepAlive);keepAlive=null;}}
  function arm(){
    disarm();
    keepAlive=setInterval(function(){
      try{if(state==='playing'&&!synth.paused)synth.resume();}catch(e){}
    },8000);
  }
  function speak(i,g){
    if(g!==gen||state!=='playing')return;
    if(i>=chunks.length){finish();return;}
    idx=i;
    var ch=chunks[i];
    clearHi();
    ch.el.classList.add('dg-on');
    var u=new SpeechSynthesisUtterance(ch.text);
    if(voice)u.voice=voice;
    try{u.rate=parseFloat(rateSel.value)||1;}catch(e){u.rate=1;}
    u.onend=function(){
      if(g!==gen||state!=='playing')return;
      progress(i);
      savePlace(i+1);
      speak(i+1,g);
    };
    u.onerror=function(){
      if(g!==gen||state!=='playing')return;
      speak(i+1,g);
    };
    try{synth.speak(u);}catch(e){if(g===gen&&state==='playing')speak(i+1,g);}
  }
  function doPlay(){
    if(state==='playing'){
      try{synth.pause();}catch(e){}
      state='paused';savePlace(idx);setPlay();disarm();unlock();return;
    }
    if(state==='paused'){
      try{synth.resume();}catch(e){}
      state='playing';setPlay();arm();lock();return;
    }
    gen++;
    try{synth.cancel();}catch(e){}
    var p=loadPlace();
    state='playing';setPlay();arm();lock();
    speak(p?p.i:0,gen);
  }
  function finish(){
    gen++;disarm();unlock();
    try{synth.cancel();}catch(e){}
    clearPlace();
    state='idle';idx=0;clearHi();progress(-1);setPlay();
  }
  function stopAll(){
    gen++;disarm();unlock();
    try{synth.cancel();}catch(e){}
    savePlace(idx);
    state='idle';idx=0;clearHi();progress(-1);setPlay();
  }
  play.addEventListener('click',doPlay);
  stopBtn.addEventListener('click',stopAll);
  rateSel.addEventListener('change',function(){
    if(state!=='playing')return;
    gen++;
    try{synth.cancel();}catch(e){}
    speak(idx,gen);
  });
  /* leaving Chrome must not kill speech; the wake lock covers screen-off,
     and on return we re-lock and reconcile if the OS stopped the audio */
  document.addEventListener('visibilitychange',function(){
    if(document.hidden){
      unlock();disarm();
      if(state==='playing')savePlace(idx);
    }else if(state==='playing'){
      lock();arm();
      try{if(!synth.speaking&&!synth.paused){state='idle';setPlay();}}catch(e){}
    }
  });
  document.addEventListener('pagehide',function(){
    savePlace(idx);unlock();disarm();
    try{synth.cancel();}catch(e){}
  });
  setPlay();
}
})();
