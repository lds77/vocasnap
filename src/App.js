import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './App.css';

// ============================================================
// 📸 VocaSnap v4.2 — 학습효율 극대화 + 안정화
// ============================================================
const DECK_EMOJIS = ['📘','📗','📙','📕','📓','📔','🎯','🧠','💡','🔬','🌍','🏆','✏️','📎','🎓','🔖'];
const DAYS_KR = ['일','월','화','수','목','금','토'];
const SESSION_SIZE = 12;

// ── SM-2 SRS ──
function calcSRS(word, quality) {
  let { interval=0, repetition=0, easeFactor=2.5 } = word.srs || {};
  if (quality >= 3) {
    if (repetition === 0) interval = 1;
    else if (repetition === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetition += 1;
  } else { repetition = 0; interval = quality === 2 ? 1 : 0; }
  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5-quality) * (0.08 + (5-quality)*0.02)));
  const nr = new Date(); nr.setDate(nr.getDate() + interval);
  return { interval, repetition, easeFactor, nextReview: nr.toISOString().split('T')[0], lastReview: getToday() };
}
function getSrsStatus(w) { if (!w.srs?.lastReview) return 'new'; if (w.srs.interval >= 21) return 'mastered'; return 'learning'; }
function isDue(w) { if (!w.srs?.nextReview) return true; return new Date(w.srs.nextReview) <= new Date(); }

// ── Utilities ──
function speak(t, lang='en-US') { if(!window.speechSynthesis)return; window.speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(t); u.lang=lang; u.rate=0.85; window.speechSynthesis.speak(u); }
function gid() { return Date.now().toString(36)+Math.random().toString(36).substr(2,6); }
function getToday() { return new Date().toISOString().split('T')[0]; }
function shuffle(a) { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; }

function mixDifficulty(list) {
  const easy=shuffle(list.filter(w=>(w.srs?.easeFactor||2.5)>=2.3));
  const hard=shuffle(list.filter(w=>(w.srs?.easeFactor||2.5)<2.3));
  const r=[]; let ei=0,hi=0;
  while(ei<easy.length||hi<hard.length){
    for(let k=0;k<(Math.random()>0.5?3:2)&&ei<easy.length;k++) r.push(easy[ei++]);
    if(hi<hard.length) r.push(hard[hi++]);
  }
  return r.length>0?r:shuffle(list);
}

function sortByReviewPriority(list) {
  const today=new Date();
  return [...list].sort((a,b)=>{
    const aO=a.srs?.nextReview?Math.max(0,(today-new Date(a.srs.nextReview))/86400000):999;
    const bO=b.srs?.nextReview?Math.max(0,(today-new Date(b.srs.nextReview))/86400000):999;
    return (bO*2+(b.wrongCount||0))-(aO*2+(a.wrongCount||0));
  });
}

function editDist(a,b) {
  const m=a.length,n=b.length;if(Math.abs(m-n)>3)return 99;
  const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++)dp[i][0]=i;for(let j=0;j<=n;j++)dp[0][j]=j;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)
    dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}
function findSimilar(word,allWords){return allWords.filter(w=>w.id!==word.id&&editDist(word.english.toLowerCase(),w.english.toLowerCase())<=2).slice(0,3);}

function fuzzyMatch(input,answer){
  const a=input.trim().toLowerCase(),b=answer.trim().toLowerCase();
  if(a===b)return 'exact';
  if(a.replace(/[\s\-]/g,'')===b.replace(/[\s\-]/g,''))return 'exact';
  if(editDist(a,b)<=1&&b.length>3)return 'close';
  return 'wrong';
}
function diffHighlight(input,correct){
  const a=input.toLowerCase().split(''),b=correct.toLowerCase().split(''),result=[];
  for(let i=0;i<Math.max(a.length,b.length);i++){
    if(i<b.length){result.push({ch:b[i],ok:i<a.length&&a[i]===b[i]});}
  }
  return result;
}

// [A2] 퀴즈 결과 학습 조언
function getStudyAdvice(score,total,wrongList,mode){
  const pct=Math.round(score/total*100);
  if(pct>=90)return mode==='choice'?'🏆 훌륭해요! 스펠링이나 빈칸 퀴즈로 도전해보세요.':'🏆 완벽에 가까워요! 이 조건으로 한 번 더 하면 완전히 굳혀요.';
  if(pct>=70){
    const hasSpelling=wrongList.some(w=>w.english.length>5);
    return hasSpelling?'👏 잘하고 있어요! 긴 단어를 중심으로 쓰기 연습을 해보세요.':'👏 좋아요! 틀린 단어만 모아서 한 번 더 복습하면 효과적이에요.';
  }
  if(pct>=50)return '💪 절반 이상! 첫 만남으로 다시 익힌 뒤 플래시카드를 반복하세요.';
  return '📖 기초를 다져요! 첫 만남 → 플래시카드 순서로 천천히 해보세요.';
}

// ── OCR ──
async function runOCR(imageData,onProgress){
  if(!window.Tesseract){await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
  const worker=await window.Tesseract.createWorker('eng+kor',1,{logger:m=>{if(m.status==='recognizing text'&&onProgress)onProgress(Math.round(m.progress*100));}});
  const{data}=await worker.recognize(imageData);await worker.terminate();return data.text;
}
function preprocessImage(base64){
  return new Promise(resolve=>{const img=new Image();img.onload=()=>{
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const d=ctx.getImageData(0,0,c.width,c.height);const px=d.data;const w=c.width,h=c.height;
    const gray=new Uint8Array(w*h);
    for(let i=0;i<px.length;i+=4)gray[i/4]=Math.round(0.299*px[i]+0.587*px[i+1]+0.114*px[i+2]);
    const blockSize=Math.max(15,Math.round(Math.min(w,h)/20)|1);const half=Math.floor(blockSize/2);
    for(let y=0;y<h;y++){for(let x=0;x<w;x++){
      let sum=0,cnt=0;const y0=Math.max(0,y-half),y1=Math.min(h-1,y+half),x0=Math.max(0,x-half),x1=Math.min(w-1,x+half);
      for(let yy=y0;yy<=y1;yy+=2)for(let xx=x0;xx<=x1;xx+=2){sum+=gray[yy*w+xx];cnt++;}
      const idx=(y*w+x)*4;const v=gray[y*w+x]<sum/cnt-12?0:255;px[idx]=px[idx+1]=px[idx+2]=v;
    }}
    ctx.putImageData(d,0,0);resolve(c.toDataURL('image/png'));
  };img.src=base64;});
}
function cropImage(base64,rect){
  return new Promise(resolve=>{const img=new Image();img.onload=()=>{
    const sx=Math.round(rect.x*img.width),sy=Math.round(rect.y*img.height);
    const sw=Math.round(rect.w*img.width),sh=Math.round(rect.h*img.height);
    if(sw<10||sh<10){resolve(base64);return;}
    const c=document.createElement('canvas');c.width=sw;c.height=sh;
    c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,sw,sh);resolve(c.toDataURL('image/png'));
  };img.src=base64;});
}
function parseOCR(raw){
  const lines=raw.split('\n').map(l=>l.trim()).filter(l=>l.length>1);const results=[];
  for(const line of lines){let eng='',kor='';const cl=line.replace(/^\d+[.\)\-\s]+/,'');
    const sep=cl.match(/^(.+?)[\s]*[-:=→~\/|][\s]*(.+)$/);
    if(sep){const[p1,p2]=[sep[1].trim(),sep[2].trim()];if(/[a-zA-Z]/.test(p1)){eng=p1;kor=p2;}else{eng=p2;kor=p1;}}
    else{const bm=cl.match(/^([a-zA-Z][a-zA-Z\s''.\-]*)\s{2,}([\u3131-\uD79D].*)$/)||cl.match(/^([a-zA-Z][a-zA-Z\s''.\-]+)\s+([\u3131-\uD79D].*)$/);
      if(bm){eng=bm[1].trim();kor=bm[2].trim();}else{const b3=cl.match(/^([\u3131-\uD79D]+.*?)\s+([a-zA-Z].*)$/);if(b3){eng=b3[2].trim();kor=b3[1].trim();}else if(/[a-zA-Z]/.test(cl))eng=cl;}}
    if(eng)results.push({english:eng.replace(/\s+/g,' '),korean:kor});}
  return results;
}
function resizeImg(file,max=1400){
  return new Promise(res=>{const r=new FileReader();r.onload=e=>{const img=new Image();img.onload=()=>{
    let w=img.width,h=img.height;if(w>max||h>max){if(w>h){h=Math.round(h*max/w);w=max;}else{w=Math.round(w*max/h);h=max;}}
    const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);res(c.toDataURL('image/jpeg',0.85));
  };img.src=e.target.result;};r.readAsDataURL(file);});
}

// ============================================================
// 🏠 메인 앱
// ============================================================
function App() {
  const [tab,setTab]=useState('home');
  const [view,setView]=useState(null);
  const [decks,setDecks]=useState(()=>{try{return JSON.parse(localStorage.getItem('vs_decks'))||[];}catch{return[];}});
  const [words,setWords]=useState(()=>{try{return JSON.parse(localStorage.getItem('vs_words'))||[];}catch{return[];}});
  const [studyLog,setStudyLog]=useState(()=>{try{return JSON.parse(localStorage.getItem('vs_studyLog'))||{};}catch{return{};}});
  const [darkMode,setDarkMode]=useState(()=>{try{return JSON.parse(localStorage.getItem('vs_dark'));}catch{return false;}});
  const [autoTTS,setAutoTTS]=useState(()=>{try{return JSON.parse(localStorage.getItem('vs_tts'));}catch{return true;}});
  const [dailyGoal,setDailyGoal]=useState(()=>{try{return parseInt(localStorage.getItem('vs_goal'))||30;}catch{return 30;}});
  // [A1] recall prompt 설정
  const [recallPrompt,setRecallPrompt]=useState(()=>{try{return JSON.parse(localStorage.getItem('vs_recall'));}catch{return true;}});
  const [toast,setToast]=useState(null);
  const [confirmDlg,setConfirmDlg]=useState(null);

  useEffect(()=>{try{localStorage.setItem('vs_decks',JSON.stringify(decks));}catch{}},[decks]);
  useEffect(()=>{try{localStorage.setItem('vs_words',JSON.stringify(words));}catch{}},[words]);
  useEffect(()=>{try{localStorage.setItem('vs_studyLog',JSON.stringify(studyLog));}catch{}},[studyLog]);
  useEffect(()=>{localStorage.setItem('vs_dark',JSON.stringify(darkMode));},[darkMode]);
  useEffect(()=>{localStorage.setItem('vs_tts',JSON.stringify(autoTTS));},[autoTTS]);
  useEffect(()=>{localStorage.setItem('vs_goal',dailyGoal.toString());},[dailyGoal]);
  useEffect(()=>{localStorage.setItem('vs_recall',JSON.stringify(recallPrompt));},[recallPrompt]);

  const showToast=useCallback(msg=>{setToast(msg);setTimeout(()=>setToast(null),2500);},[]);
  const logStudy=useCallback((n=1)=>{const t=getToday();setStudyLog(p=>({...p,[t]:(p[t]||0)+n}));},[]);

  const createDeck=(name,emoji)=>{const d={id:gid(),name,emoji:emoji||'📘',createdAt:new Date().toISOString()};setDecks(p=>[d,...p]);showToast(`"${name}" 생성!`);return d;};
  const deleteDeck=id=>{setDecks(p=>p.filter(d=>d.id!==id));setWords(p=>p.filter(w=>w.deckId!==id));};
  const renameDeck=(id,name)=>setDecks(p=>p.map(d=>d.id===id?{...d,name}:d));
  const addWords=(deckId,list)=>{
    const nw=list.map(w=>({id:gid(),deckId,english:w.english.trim(),korean:w.korean.trim(),example:w.example||'',starred:false,wrongCount:0,correctCount:0,introduced:false,srs:{},createdAt:new Date().toISOString()}));
    setWords(p=>[...p,...nw]);return nw;
  };
  const updateWord=(id,u)=>setWords(p=>p.map(w=>w.id===id?{...w,...u}:w));
  const deleteWord=id=>setWords(p=>p.filter(w=>w.id!==id));
  const moveWords=(ids,to)=>setWords(p=>p.map(w=>ids.includes(w.id)?{...w,deckId:to}:w));
  // [B1] 일괄 삭제
  const deleteWords=ids=>setWords(p=>p.filter(w=>!ids.includes(w.id)));

  const wordsFor=useCallback(id=>words.filter(w=>w.deckId===id),[words]);
  const dueFor=useCallback(id=>words.filter(w=>w.deckId===id&&isDue(w)),[words]);
  const todayCount=studyLog[getToday()]||0;
  const streak=useMemo(()=>{let s=0;const d=new Date();if(!studyLog[getToday()])d.setDate(d.getDate()-1);while(studyLog[d.toISOString().split('T')[0]]>0){s++;d.setDate(d.getDate()-1);}return s;},[studyLog]);

  // [A3] 전체 복습 통합 학습 - 모든 덱의 due 단어를 합쳐서
  const allDueWords=useMemo(()=>words.filter(isDue),[words]);

  const startTodayStudy=useCallback(()=>{
    // 새 단어 있으면 첫 만남
    for(const dk of decks){const nw=words.filter(w=>w.deckId===dk.id&&!w.introduced);if(nw.length>0){setView({type:'introduce',deckId:dk.id});return;}}
    // [A3] 모든 덱의 due 합쳐서 통합 복습
    if(allDueWords.length>0){setView({type:'study',deckId:'__all__',mode:'due'});return;}
    if(decks.length>0&&words.length>0){setView({type:'study',deckId:decks[0].id,mode:'all'});}
  },[decks,words,allDueWords]);

  if(view){
    const shell=cn=><div className={`app-shell ${darkMode?'dark-mode':''}`}>{cn}{toast&&<div className="toast">{toast}</div>}</div>;
    if(view.type==='addSnap')return shell(<AddSnapView deckId={view.deckId} decks={decks} allWords={words} onCreateDeck={createDeck}
      onSave={(did,wl)=>{const a=addWords(did,wl);showToast(`${a.length}개 등록!`);setView({type:'deck',id:did});}}
      onBack={()=>setView(view.deckId?{type:'deck',id:view.deckId}:null)} />);
    if(view.type==='deck')return shell(<><DeckDetailView deck={decks.find(d=>d.id===view.id)} words={wordsFor(view.id)} allDecks={decks} allWords={words}
      dueCount={dueFor(view.id).length} onBack={()=>setView(null)}
      onAddSnap={()=>setView({type:'addSnap',deckId:view.id})}
      onStudy={m=>setView({type:'study',deckId:view.id,mode:m})}
      onIntroduce={()=>setView({type:'introduce',deckId:view.id})}
      onQuiz={(m,dir,cnt)=>setView({type:'quiz',deckId:view.id,mode:m,direction:dir,count:cnt})}
      onUpdateWord={updateWord} onDeleteWord={id=>{deleteWord(id);showToast('삭제됨');}}
      onDeleteWords={(ids)=>{deleteWords(ids);showToast(`${ids.length}개 삭제됨`);}}
      onMoveWords={moveWords}
      onDeleteDeck={()=>setConfirmDlg({title:'단어장 삭제',msg:'모든 단어가 함께 삭제됩니다.',onConfirm:()=>{deleteDeck(view.id);setView(null);setConfirmDlg(null);}})}
      onRenameDeck={renameDeck} showToast={showToast} />
      {confirmDlg&&<ConfirmDialog {...confirmDlg} onCancel={()=>setConfirmDlg(null)} />}</>);
    if(view.type==='introduce')return shell(<IntroduceView words={wordsFor(view.deckId).filter(w=>!w.introduced)}
      onBack={()=>setView({type:'deck',id:view.deckId})} onUpdateWord={updateWord} onLogStudy={logStudy} />);
    if(view.type==='study'){
      // [A3] __all__ 이면 모든 덱의 due 통합
      const studyWords=view.deckId==='__all__'?sortByReviewPriority(allDueWords)
        :view.mode==='due'?sortByReviewPriority(dueFor(view.deckId))
        :view.mode==='starred'?wordsFor(view.deckId).filter(w=>w.starred):wordsFor(view.deckId);
      return shell(<StudyView words={studyWords} allWords={words}
        onBack={()=>setView(view.deckId==='__all__'?null:{type:'deck',id:view.deckId})}
        onUpdateWord={updateWord} onLogStudy={logStudy} autoTTS={autoTTS} recallPrompt={recallPrompt} />);
    }
    if(view.type==='quiz')return shell(<QuizView allWords={wordsFor(view.deckId)} mode={view.mode}
      direction={view.direction||'e2k'} maxQ={view.count||20} onBack={()=>setView({type:'deck',id:view.deckId})}
      onUpdateWord={updateWord} onLogStudy={logStudy}
      onRetryWrong={wl=>setView({...view,retryWords:wl})} retryWords={view.retryWords} />);
  }

  return (
    <div className={`app-shell ${darkMode?'dark-mode':''}`}>
      <div className="app-header"><h1><span className="logo-icon">📸</span> VocaSnap</h1>
        <div className="header-actions"><button className="header-btn" onClick={()=>setDarkMode(!darkMode)}>{darkMode?'☀️':'🌙'}</button></div></div>
      {tab==='home'&&<HomePage decks={decks} words={words} todayCount={todayCount} dailyGoal={dailyGoal} streak={streak}
        onOpenDeck={id=>setView({type:'deck',id})} onAddSnap={()=>setView({type:'addSnap'})} onStartToday={startTodayStudy}
        allDueCount={allDueWords.length} />}
      {tab==='decks'&&<DecksPage decks={decks} words={words} onOpenDeck={id=>setView({type:'deck',id})} onCreateDeck={createDeck} />}
      {tab==='stats'&&<StatsPage studyLog={studyLog} words={words} decks={decks} dailyGoal={dailyGoal} />}
      {tab==='settings'&&<SettingsPage darkMode={darkMode} setDarkMode={setDarkMode} autoTTS={autoTTS} setAutoTTS={setAutoTTS}
        dailyGoal={dailyGoal} setDailyGoal={setDailyGoal} recallPrompt={recallPrompt} setRecallPrompt={setRecallPrompt}
        words={words} decks={decks} showToast={showToast} setWords={setWords} setDecks={setDecks} setStudyLog={setStudyLog} />}
      {!view&&<button className="fab" onClick={()=>setView({type:'addSnap'})}>📷</button>}
      <div className="bottom-nav">
        {[{id:'home',icon:'🏠',label:'홈'},{id:'decks',icon:'📚',label:'단어장'},{id:'stats',icon:'📊',label:'통계'},{id:'settings',icon:'⚙️',label:'설정'}].map(t=>(
          <button key={t.id} className={`nav-item ${tab===t.id?'active':''}`} onClick={()=>{setTab(t.id);setView(null);}}>
            <span className="nav-icon">{t.icon}</span>{t.label}</button>))}
      </div>
      {toast&&<div className="toast">{toast}</div>}
      {confirmDlg&&<ConfirmDialog {...confirmDlg} onCancel={()=>setConfirmDlg(null)} />}
    </div>
  );
}

// ── 홈: [A3] 통합복습 표시 + [C1] 글로벌검색 ──
function HomePage({decks,words,todayCount,dailyGoal,streak,onOpenDeck,onAddSnap,onStartToday,allDueCount}){
  const mastered=words.filter(w=>getSrsStatus(w)==='mastered').length;
  const newW=words.filter(w=>!w.introduced).length;
  const goalPct=Math.min(100,Math.round(todayCount/dailyGoal*100));
  const todayTasks=[];
  if(newW>0)todayTasks.push(`👋 새 단어 ${newW}개`);
  if(allDueCount>0)todayTasks.push(`📖 복습 ${allDueCount}개`);
  // [C1] 글로벌 검색
  const [gSearch,setGSearch]=useState('');
  const gResults=gSearch.length>=2?words.filter(w=>w.english.toLowerCase().includes(gSearch.toLowerCase())||w.korean.includes(gSearch)).slice(0,10):[];

  return (
    <div className="page-content">
      {streak>0&&<div className="streak-display"><span className="streak-fire">🔥</span><span className="streak-count">{streak}</span><span className="streak-label">일 연속!</span></div>}
      {(todayTasks.length>0&&goalPct<100)&&(
        <button className="today-study-btn" onClick={onStartToday}>
          <div className="today-study-left"><div className="today-study-title">🚀 오늘의 학습 시작</div>
            <div className="today-study-tasks">{todayTasks.join(' → ')}</div></div>
          <span className="today-study-arrow">›</span></button>)}
      <div className="card" style={{padding:16}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:8,fontSize:'0.85rem'}}>
          <span style={{fontWeight:600}}>🎯 오늘 목표</span>
          <span style={{color:goalPct>=100?'var(--success)':'var(--accent)',fontWeight:700}}>{todayCount}/{dailyGoal}</span></div>
        <div className="deck-progress" style={{height:8}}><div className="deck-progress-bar" style={{width:`${goalPct}%`,background:goalPct>=100?'var(--success)':'var(--accent)'}} /></div>
        {goalPct>=100&&<div style={{fontSize:'0.75rem',color:'var(--success)',marginTop:6,fontWeight:600}}>🎉 목표 달성!</div>}
      </div>
      <div className="stats-row">
        <div className="stat-item"><div className="stat-value">{words.length}</div><div className="stat-label">전체</div></div>
        <div className="stat-item"><div className="stat-value">{mastered}</div><div className="stat-label">암기완료</div></div>
        <div className="stat-item"><div className="stat-value">{allDueCount}</div><div className="stat-label">복습필요</div></div>
      </div>
      {/* [C1] 글로벌 검색 */}
      <div className="search-bar"><span className="search-icon">🔍</span><input placeholder="전체 단어 검색..." value={gSearch} onChange={e=>setGSearch(e.target.value)} /></div>
      {gResults.length>0&&<div className="card" style={{padding:8}}>
        {gResults.map(w=>{const dk=decks.find(d=>d.id===w.deckId);return(
          <div key={w.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 4px',borderBottom:'1px solid var(--border)',fontSize:'0.85rem'}} onClick={()=>onOpenDeck(w.deckId)}>
            <span style={{fontWeight:600,flex:1}}>{w.english}</span><span style={{color:'var(--text-tertiary)',flex:1}}>{w.korean}</span>
            <span style={{fontSize:'0.7rem',color:'var(--accent)'}}>{dk?.emoji}{dk?.name}</span></div>);})}
      </div>}
      {newW>0&&goalPct<100&&!gSearch&&<div className="card" style={{background:'linear-gradient(135deg,#667eea,#764ba2)',color:'#fff',border:'none',padding:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div><div style={{fontSize:'0.8rem',opacity:0.85}}>🆕 새 단어</div><div style={{fontSize:'1.5rem',fontWeight:800}}>{newW}개 대기</div></div>
          <span style={{fontSize:'2rem'}}>👋</span></div></div>}
      {!gSearch&&<><div className="card-header" style={{marginTop:4}}><span className="card-title">📚 내 단어장</span></div>
      {decks.length===0?(
        <div className="empty-state"><div className="empty-icon">📸</div><div className="empty-title">첫 단어장을 만들어보세요!</div>
          <button className="btn btn-primary" onClick={onAddSnap}>📷 사진으로 등록</button></div>
      ):(
        <div className="deck-list">{decks.map(dk=>{
          const dw=words.filter(w=>w.deckId===dk.id);
          const pct=dw.length>0?Math.round(dw.filter(w=>getSrsStatus(w)==='mastered').length/dw.length*100):0;
          return (<div key={dk.id} className="deck-card" onClick={()=>onOpenDeck(dk.id)}>
            <div className="deck-emoji">{dk.emoji}</div><div className="deck-info"><div className="deck-name">{dk.name}</div>
              <div className="deck-meta">{dw.length}개 · {pct}%</div><div className="deck-progress"><div className="deck-progress-bar" style={{width:`${pct}%`}} /></div></div>
            <span className="deck-arrow">›</span></div>);
        })}</div>)}</>}
    </div>
  );
}

// ── 단어장 목록 ──
function DecksPage({decks,words,onOpenDeck,onCreateDeck}){
  const [showNew,setShowNew]=useState(false);const [newName,setNewName]=useState('');const [newEmoji,setNewEmoji]=useState('📘');const [search,setSearch]=useState('');
  const filtered=decks.filter(d=>d.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="page-content">
      <div className="search-bar"><span className="search-icon">🔍</span><input placeholder="검색..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
      {showNew?(
        <div className="card">
          <div className="form-group"><label className="form-label">이름</label><input className="form-input" placeholder="예: 토익 Day1" value={newName} onChange={e=>setNewName(e.target.value)} autoFocus /></div>
          <div className="form-group"><label className="form-label">아이콘</label><div className="emoji-grid">{DECK_EMOJIS.map(em=><button key={em} className={`emoji-option ${newEmoji===em?'selected':''}`} onClick={()=>setNewEmoji(em)}>{em}</button>)}</div></div>
          <div style={{display:'flex',gap:8}}><button className="btn btn-secondary btn-full" onClick={()=>{setShowNew(false);setNewName('');}}>취소</button>
            <button className="btn btn-primary btn-full" onClick={()=>{if(!newName.trim())return;onCreateDeck(newName.trim(),newEmoji);setNewName('');setShowNew(false);}}>만들기</button></div></div>
      ):<button className="btn btn-secondary btn-full mb-16" onClick={()=>setShowNew(true)}>＋ 새 단어장</button>}
      <div className="deck-list">{filtered.map(dk=>{const dw=words.filter(w=>w.deckId===dk.id);
        const pct=dw.length>0?Math.round(dw.filter(w=>getSrsStatus(w)==='mastered').length/dw.length*100):0;
        return (<div key={dk.id} className="deck-card" onClick={()=>onOpenDeck(dk.id)}><div className="deck-emoji">{dk.emoji}</div><div className="deck-info"><div className="deck-name">{dk.name}</div>
          <div className="deck-meta">{dw.length}개 · {pct}%</div><div className="deck-progress"><div className="deck-progress-bar" style={{width:`${pct}%`}} /></div></div><span className="deck-arrow">›</span></div>);
      })}</div></div>);
}

// ── 크롭 ──
function CropOverlay({photo,onCrop,onSkip,onCancel}){
  const containerRef=useRef(null);const [dragging,setDragging]=useState(false);const [start,setStart]=useState(null);const [rect,setRect]=useState(null);
  const getPos=e=>{const el=containerRef.current;if(!el)return{x:0,y:0};const br=el.getBoundingClientRect();const t=e.touches?e.touches[0]:e;
    return{x:Math.max(0,Math.min(1,(t.clientX-br.left)/br.width)),y:Math.max(0,Math.min(1,(t.clientY-br.top)/br.height))};};
  const onDown=e=>{e.preventDefault();const p=getPos(e);setStart(p);setDragging(true);setRect(null);};
  const onMove=e=>{if(!dragging||!start)return;e.preventDefault();const p=getPos(e);setRect({x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(p.x-start.x),h:Math.abs(p.y-start.y)});};
  const onUp=()=>setDragging(false);
  return(<div className="crop-fullscreen"><div className="crop-header"><button className="back-btn" onClick={onCancel}>←</button><span className="sub-header-title">✂️ 텍스트 영역 선택</span></div>
    <div className="crop-guide">드래그하여 텍스트 영역을 선택하세요</div>
    <div className="crop-container" ref={containerRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}>
      <img src={photo} alt="" className="crop-image" draggable={false} />
      {rect&&rect.w>0.01&&rect.h>0.01&&(<>
        <div className="crop-mask crop-mask-top" style={{height:`${rect.y*100}%`}} />
        <div className="crop-mask crop-mask-bottom" style={{height:`${(1-rect.y-rect.h)*100}%`}} />
        <div className="crop-mask crop-mask-left" style={{top:`${rect.y*100}%`,height:`${rect.h*100}%`,width:`${rect.x*100}%`}} />
        <div className="crop-mask crop-mask-right" style={{top:`${rect.y*100}%`,height:`${rect.h*100}%`,width:`${(1-rect.x-rect.w)*100}%`}} />
        <div className="crop-selection" style={{left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.w*100}%`,height:`${rect.h*100}%`}}>
          <div className="crop-corner crop-tl"/><div className="crop-corner crop-tr"/><div className="crop-corner crop-bl"/><div className="crop-corner crop-br"/></div></>)}
    </div>
    <div className="crop-actions"><button className="btn btn-secondary" onClick={onSkip}>전체 인식</button>
      <button className="btn btn-primary" disabled={!rect||rect.w<0.03||rect.h<0.03} onClick={()=>rect&&onCrop(rect)}>✂️ 선택 영역 인식</button></div>
  </div>);
}

// ── OCR 스냅 ──
function AddSnapView({deckId,decks,allWords,onCreateDeck,onSave,onBack}){
  const [photo,setPhoto]=useState(null);const [ocrState,setOcrState]=useState('idle');const [ocrProgress,setOcrProgress]=useState(0);
  const [parsed,setParsed]=useState([]);const [selDeck,setSelDeck]=useState(deckId||'');const [newDeckName,setNewDeckName]=useState('');
  const [showNewDeck,setShowNewDeck]=useState(false);const [simWarns,setSimWarns]=useState({});
  const fileRef=useRef(null);const camRef=useRef(null);
  useEffect(()=>{const w={};parsed.forEach((p,i)=>{if(p.english.trim().length>2){
    const sim=allWords.filter(aw=>editDist(p.english.trim().toLowerCase(),aw.english.toLowerCase())<=2&&editDist(p.english.trim().toLowerCase(),aw.english.toLowerCase())>0);
    if(sim.length>0)w[i]=sim.map(s=>s.english).slice(0,2);}});setSimWarns(w);},[parsed,allWords]);
  const handleFile=async e=>{const f=e.target.files?.[0];if(!f)return;const img=await resizeImg(f);setPhoto(img);setOcrState('crop');};
  const doOCR=async(imageData)=>{setOcrState('loading');setOcrProgress(0);try{const processed=await preprocessImage(imageData);const text=await runOCR(processed,p=>setOcrProgress(p));
    const p=parseOCR(text);setParsed(p.length?p:[{english:'',korean:''}]);setOcrState('done');}catch{setOcrState('error');setParsed([{english:'',korean:''}]);}};
  const handleCrop=async rect=>{const cropped=await cropImage(photo,rect);doOCR(cropped);};
  const handleSave=()=>{let did=selDeck;if(showNewDeck&&newDeckName.trim()){const nd=onCreateDeck(newDeckName.trim(),'📘');did=nd.id;}
    if(!did){alert('단어장을 선택해주세요');return;}const valid=parsed.filter(w=>w.english.trim());if(!valid.length){alert('최소 1개');return;}onSave(did,valid);};
  if(ocrState==='crop'&&photo)return <CropOverlay photo={photo} onCrop={handleCrop} onSkip={()=>doOCR(photo)} onCancel={()=>{setPhoto(null);setOcrState('idle');}} />;
  return (
    <div className="modal-full" style={{background:'var(--bg-primary)'}}>
      <div className="sub-header"><button className="back-btn" onClick={onBack}>←</button><span className="sub-header-title">📷 단어 등록</span></div>
      <div className="page-content">
        {!photo&&ocrState==='idle'?(<div>
          <div className="photo-capture-area" onClick={()=>camRef.current?.click()}><div className="photo-capture-icon">📷</div><div className="photo-capture-text">카메라로 촬영</div><div className="photo-capture-sub">단어장을 찍어보세요</div></div>
          <div style={{textAlign:'center',margin:'12px 0',color:'var(--text-tertiary)',fontSize:'0.8rem'}}>또는</div>
          <button className="btn btn-secondary btn-full" onClick={()=>fileRef.current?.click()}>🖼️ 갤러리</button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={handleFile} />
          <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleFile} />
          <div style={{textAlign:'center',marginTop:24}}><button className="btn btn-secondary btn-sm" onClick={()=>{setParsed([{english:'',korean:''},{english:'',korean:''},{english:'',korean:''}]);setOcrState('done');}}>✏️ 직접 입력</button></div>
        </div>):(<div>
          {photo&&ocrState!=='crop'&&<div className="photo-preview"><img src={photo} alt="" /><div className="photo-preview-actions">
            <button className="photo-action-btn" onClick={()=>{setPhoto(null);setOcrState('idle');setParsed([]);}}>✕</button>
            <button className="photo-action-btn" onClick={()=>setOcrState('crop')}>✂️</button></div></div>}
          {ocrState==='loading'&&<div className="ocr-loading"><div className="ocr-spinner" /><div className="ocr-progress-text">인식 중... {ocrProgress}%</div></div>}
          {ocrState==='error'&&<div className="card" style={{textAlign:'center',color:'var(--danger)'}}>⚠️ OCR 실패 <button className="btn btn-sm btn-secondary" style={{marginLeft:8}} onClick={()=>setOcrState('crop')}>다시 크롭</button></div>}
        </div>)}
        {ocrState==='done'&&(<div className="ocr-section">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <span className="card-title">✏️ 결과 ({parsed.length}개)</span>{photo&&<button className="btn btn-sm btn-secondary" onClick={()=>setOcrState('crop')}>✂️ 다시 크롭</button>}</div>
          <div className="ocr-word-list">{parsed.map((w,i)=>(<div key={i}><div className="ocr-word-item">
            <input className="form-input" placeholder="영단어" value={w.english} onChange={e=>setParsed(p=>p.map((x,j)=>j===i?{...x,english:e.target.value}:x))} />
            <span className="ocr-word-sep">→</span><input className="form-input" placeholder="뜻" value={w.korean} onChange={e=>setParsed(p=>p.map((x,j)=>j===i?{...x,korean:e.target.value}:x))} />
            <button className="ocr-word-delete" onClick={()=>setParsed(p=>p.filter((_,j)=>j!==i))}>✕</button></div>
            {simWarns[i]&&<div style={{fontSize:'0.7rem',color:'var(--warning)',padding:'2px 8px',marginBottom:4}}>⚠️ 유사어: {simWarns[i].join(', ')}</div>}</div>))}
            <button className="ocr-add-row" onClick={()=>setParsed(p=>[...p,{english:'',korean:''}])}>＋ 추가</button></div>
          <div className="form-group" style={{marginTop:20}}><label className="form-label">저장할 단어장</label>
            {!showNewDeck?(<div><select className="form-select" value={selDeck} onChange={e=>setSelDeck(e.target.value)}>
              <option value="">선택...</option>{decks.map(d=><option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}</select>
              <button className="btn btn-secondary btn-sm btn-full mt-8" onClick={()=>setShowNewDeck(true)}>＋ 새 단어장</button></div>
            ):(<div><input className="form-input" placeholder="이름" value={newDeckName} onChange={e=>setNewDeckName(e.target.value)} autoFocus />
              <button className="btn btn-secondary btn-sm mt-8" onClick={()=>setShowNewDeck(false)}>← 기존 선택</button></div>)}</div>
          <button className="btn btn-primary btn-full btn-lg mt-16" onClick={handleSave}>✅ {parsed.filter(w=>w.english.trim()).length}개 저장</button></div>)}
      </div></div>);
}

// ── 첫 만남 ──
function IntroduceView({words,onBack,onUpdateWord,onLogStudy}){
  const [idx,setIdx]=useState(0);const [step,setStep]=useState(0);
  const cards=useMemo(()=>words.slice(0,SESSION_SIZE),[words]);
  if(!cards.length)return(<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button><span className="sub-header-title">첫 만남</span></div>
    <div className="empty-state"><div className="empty-icon">✅</div><div className="empty-title">모든 단어를 만났어요!</div><button className="btn btn-primary mt-16" onClick={onBack}>돌아가기</button></div></div>);
  if(idx>=cards.length)return(<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button><span className="sub-header-title">완료!</span></div>
    <div className="quiz-result"><div className="quiz-result-icon">👋</div><div className="quiz-result-score">{cards.length}개</div><div className="quiz-result-label">새 단어를 만났어요!</div>
      <button className="btn btn-primary btn-lg mt-16" onClick={onBack}>돌아가기</button></div></div>);
  const cur=cards[idx];const goNext=()=>{onUpdateWord(cur.id,{introduced:true});onLogStudy(1);setIdx(i=>i+1);setStep(0);};
  return (<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button><span className="sub-header-title">👋 첫 만남</span>
    <span style={{fontSize:'0.8rem',color:'var(--text-tertiary)'}}>{idx+1}/{cards.length}</span></div>
    <div className="page-content"><div className="quiz-progress-bar"><div className="quiz-progress-fill" style={{width:`${((idx+1)/cards.length)*100}%`}} /></div>
      <div className="card" style={{textAlign:'center',padding:30,marginTop:16}}><div style={{fontSize:'2rem',fontWeight:700,marginBottom:8}}>{cur.english}</div>
        {step>=1&&<div style={{marginBottom:12}}><button className="tts-btn" style={{margin:'0 auto'}} onClick={()=>speak(cur.english)}>🔊 다시 듣기</button></div>}
        {step>=2&&<div><div style={{fontSize:'1.3rem',fontWeight:600,color:'var(--accent)',marginBottom:8}}>{cur.korean||'뜻 미입력'}</div>
          {cur.example&&<div style={{fontSize:'0.85rem',color:'var(--text-secondary)',fontStyle:'italic'}}>"{cur.example}"</div>}</div>}</div>
      <div style={{display:'flex',gap:8,marginTop:16}}>
        {step===0&&<button className="btn btn-primary btn-full btn-lg" onClick={()=>{speak(cur.english);setStep(1);}}>🔊 발음 듣기</button>}
        {step===1&&<button className="btn btn-primary btn-full btn-lg" onClick={()=>setStep(2)}>💡 뜻 확인</button>}
        {step===2&&<button className="btn btn-success btn-full btn-lg" onClick={goNext}>✅ 다음 →</button>}</div>
    </div></div>);
}

// ── 덱 상세 [B1 일괄선택/삭제] ──
function DeckDetailView({deck,words,allDecks,allWords,dueCount,onBack,onAddSnap,onStudy,onIntroduce,onQuiz,onUpdateWord,onDeleteWord,onDeleteWords,onMoveWords,onDeleteDeck,onRenameDeck,showToast}){
  const [tabV,setTabV]=useState('words');const [search,setSearch]=useState('');const [editing,setEditing]=useState(null);
  const [sortBy,setSortBy]=useState('date');const [showQuizOpt,setShowQuizOpt]=useState(false);
  const [quizDir,setQuizDir]=useState('e2k');const [quizCount,setQuizCount]=useState(20);const [quizMode,setQuizMode]=useState('choice');
  const [renaming,setRenaming]=useState(false);const [renameTxt,setRenameTxt]=useState('');
  // [B1] 일괄 선택
  const [selectMode,setSelectMode]=useState(false);const [selected,setSelected]=useState(new Set());
  if(!deck)return null;
  const mastered=words.filter(w=>getSrsStatus(w)==='mastered').length;
  const starred=words.filter(w=>w.starred).length;
  const newW=words.filter(w=>!w.introduced).length;
  const weakWords=words.filter(w=>(w.wrongCount||0)>=3);
  const relapsedWords=words.filter(w=>getSrsStatus(w)==='learning'&&(w.correctCount||0)>=3&&(w.wrongCount||0)>=2);
  let sorted=words.filter(w=>w.english.toLowerCase().includes(search.toLowerCase())||w.korean.includes(search));
  if(sortBy==='alpha')sorted=[...sorted].sort((a,b)=>a.english.localeCompare(b.english));
  else if(sortBy==='difficulty')sorted=[...sorted].sort((a,b)=>(a.srs?.easeFactor||2.5)-(b.srs?.easeFactor||2.5));
  else if(sortBy==='random')sorted=shuffle(sorted);

  const toggleSelect=id=>{const s=new Set(selected);if(s.has(id))s.delete(id);else s.add(id);setSelected(s);};
  const selectAll=()=>{if(selected.size===sorted.length)setSelected(new Set());else setSelected(new Set(sorted.map(w=>w.id)));};

  return (
    <div className="modal-full">
      <div className="sub-header"><button className="back-btn" onClick={onBack}>←</button>
        <span className="sub-header-title" onClick={()=>{setRenaming(true);setRenameTxt(deck.name);}}>{deck.emoji} {deck.name}</span>
        <div className="sub-header-actions"><button className="header-btn" onClick={onAddSnap}>📷</button><button className="header-btn" onClick={onDeleteDeck}>🗑️</button></div></div>
      <div className="page-content">
        <div className="stats-row">
          <div className="stat-item"><div className="stat-value">{words.length}</div><div className="stat-label">전체</div></div>
          <div className="stat-item"><div className="stat-value" style={{color:'var(--success)'}}>{mastered}</div><div className="stat-label">암기</div></div>
          <div className="stat-item"><div className="stat-value" style={{color:'var(--warning)'}}>{dueCount}</div><div className="stat-label">복습</div></div></div>
        {words.length>0&&(<div className="deck-actions-grid" style={{gridTemplateColumns:'repeat(3,1fr)'}}>
          {newW>0&&<button className="deck-action-card" onClick={onIntroduce} style={{background:'linear-gradient(135deg,#667eea22,#764ba222)',border:'2px solid #667eea44'}}>
            <span className="deck-action-icon">👋</span><span className="deck-action-label">첫 만남</span><span className="deck-action-desc">{newW}개</span></button>}
          <button className="deck-action-card" onClick={()=>onStudy('all')}><span className="deck-action-icon">🔄</span><span className="deck-action-label">플래시카드</span><span className="deck-action-desc">{words.length}개</span></button>
          <button className="deck-action-card" onClick={()=>dueCount>0&&onStudy('due')} style={{opacity:dueCount?1:0.4}}><span className="deck-action-icon">📖</span><span className="deck-action-label">복습</span><span className="deck-action-desc">{dueCount}개</span></button>
          <button className="deck-action-card" onClick={()=>starred>0&&onStudy('starred')} style={{opacity:starred?1:0.4}}><span className="deck-action-icon">⭐</span><span className="deck-action-label">즐겨찾기</span><span className="deck-action-desc">{starred}개</span></button>
          <button className="deck-action-card" onClick={()=>words.length>=2&&setShowQuizOpt(true)} style={{opacity:words.length>=2?1:0.4}}><span className="deck-action-icon">📝</span><span className="deck-action-label">퀴즈</span><span className="deck-action-desc">설정</span></button>
        </div>)}
        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}>
          <div className="tab-pills" style={{flex:1,marginBottom:0}}>
            <button className={`tab-pill ${tabV==='words'?'active':''}`} onClick={()=>setTabV('words')}>단어 ({words.length})</button>
            <button className={`tab-pill ${tabV==='status'?'active':''}`} onClick={()=>setTabV('status')}>현황</button></div>
          {tabV==='words'&&<select className="form-select" style={{width:'auto',padding:'6px 8px',fontSize:'0.75rem'}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="date">등록순</option><option value="alpha">알파벳</option><option value="difficulty">난이도</option><option value="random">랜덤</option></select>}
        </div>
        {tabV==='words'&&(<div>
          {words.length>5&&<div className="search-bar"><span className="search-icon">🔍</span><input placeholder="검색..." value={search} onChange={e=>setSearch(e.target.value)} /></div>}
          {/* [B1] 일괄 선택 바 */}
          <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'center'}}>
            <button className="btn btn-sm btn-secondary" onClick={()=>{setSelectMode(!selectMode);setSelected(new Set());}}>{selectMode?'취소':'☑️ 선택'}</button>
            {selectMode&&<><button className="btn btn-sm btn-secondary" onClick={selectAll}>{selected.size===sorted.length?'전체 해제':'전체 선택'}</button>
              {selected.size>0&&<button className="btn btn-sm btn-danger" onClick={()=>{if(window.confirm(`${selected.size}개 삭제?`)){onDeleteWords([...selected]);setSelected(new Set());setSelectMode(false);}}}>🗑️ {selected.size}개 삭제</button>}
              {selected.size>0&&allDecks.length>1&&<select className="form-select" style={{width:'auto',padding:'4px 6px',fontSize:'0.7rem'}} value="" onChange={e=>{if(e.target.value){onMoveWords([...selected],e.target.value);showToast(`${selected.size}개 이동`);setSelected(new Set());setSelectMode(false);}}}>
                <option value="">이동...</option>{allDecks.filter(d=>d.id!==deck.id).map(d=><option key={d.id} value={d.id}>{d.emoji}{d.name}</option>)}</select>}</>}
          </div>
          {sorted.length===0?<div className="empty-state"><div className="empty-icon">📝</div><div className="empty-title">없어요</div><button className="btn btn-primary" onClick={onAddSnap}>📷</button></div>
          :<div className="word-list">{sorted.map(w=>(
            <div key={w.id} className={`word-item ${selectMode&&selected.has(w.id)?'word-selected':''}`}>
              {selectMode?<button className="word-star" onClick={()=>toggleSelect(w.id)}>{selected.has(w.id)?'☑️':'⬜'}</button>
                :<button className="word-star" onClick={()=>onUpdateWord(w.id,{starred:!w.starred})}>{w.starred?'⭐':'☆'}</button>}
              <div className="word-content" onClick={()=>selectMode?toggleSelect(w.id):setEditing({...w})}>
                <div className="word-english">{w.english} {!w.introduced&&<span style={{fontSize:'0.6rem',color:'var(--accent)',fontWeight:700}}>NEW</span>}</div>
                <div className="word-korean">{w.korean||'뜻 미입력'}</div></div>
              <span className={`word-srs-badge srs-${getSrsStatus(w)}`}>{getSrsStatus(w)==='new'?'NEW':getSrsStatus(w)==='learning'?'학습중':'✓'}</span>
              {!selectMode&&<button className="tts-btn" onClick={e=>{e.stopPropagation();speak(w.english);}}>🔊</button>}
            </div>))}</div>}
        </div>)}
        {tabV==='status'&&(<div>
          <div className="card">
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}><span>🆕 새 단어</span><b>{words.filter(w=>getSrsStatus(w)==='new').length}</b></div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}><span>📖 학습 중</span><b style={{color:'var(--warning)'}}>{words.filter(w=>getSrsStatus(w)==='learning').length}</b></div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}><span>✅ 암기</span><b style={{color:'var(--success)'}}>{mastered}</b></div>
            <div style={{display:'flex',justifyContent:'space-between'}}><span>⭐ 즐겨찾기</span><b style={{color:'var(--accent)'}}>{starred}</b></div></div>
          {(weakWords.length>0||relapsedWords.length>0)&&<div className="card"><div className="card-title" style={{marginBottom:8}}>🔍 약점 분석</div>
            {weakWords.length>0&&<div style={{marginBottom:10}}><div style={{fontSize:'0.75rem',color:'var(--danger)',fontWeight:600,marginBottom:4}}>😰 자주 틀림 (3회+)</div>
              {weakWords.slice(0,5).map(w=><div key={w.id} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:'0.8rem'}}><span style={{fontWeight:600}}>{w.english}</span><span style={{color:'var(--danger)'}}>✗{w.wrongCount}</span></div>)}</div>}
            {relapsedWords.length>0&&<div><div style={{fontSize:'0.75rem',color:'var(--warning)',fontWeight:600,marginBottom:4}}>🔄 외웠다 다시 틀림</div>
              {relapsedWords.slice(0,5).map(w=><div key={w.id} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:'0.8rem'}}><span style={{fontWeight:600}}>{w.english}</span><span style={{color:'var(--text-tertiary)'}}>✓{w.correctCount} ✗{w.wrongCount}</span></div>)}</div>}
          </div>}
          {words.length>0&&<div className="card"><div className="card-title" style={{marginBottom:8}}>진행률</div>
            <div style={{display:'flex',alignItems:'center',gap:12}}><div style={{flex:1}}><div className="deck-progress" style={{height:8}}><div className="deck-progress-bar" style={{width:`${Math.round(mastered/words.length*100)}%`,background:'var(--success)'}} /></div></div>
              <span style={{fontWeight:700}}>{Math.round(mastered/words.length*100)}%</span></div></div>}
        </div>)}
      </div>
      {editing&&<div className="modal-overlay" onClick={()=>setEditing(null)}><div className="modal-sheet" onClick={e=>e.stopPropagation()}>
        <div className="modal-handle" /><div className="modal-title">✏️ 편집</div>
        <div className="form-group"><label className="form-label">영단어</label><input className="form-input" value={editing.english} onChange={e=>setEditing({...editing,english:e.target.value})} /></div>
        <div className="form-group"><label className="form-label">뜻</label><input className="form-input" value={editing.korean} onChange={e=>setEditing({...editing,korean:e.target.value})} /></div>
        <div className="form-group"><label className="form-label">예문</label><input className="form-input" value={editing.example||''} onChange={e=>setEditing({...editing,example:e.target.value})} placeholder="빈칸퀴즈에 활용" /></div>
        <div className="form-group"><label className="form-label">이동</label><select className="form-select" value="" onChange={e=>{if(e.target.value){onMoveWords([editing.id],e.target.value);showToast('이동!');setEditing(null);}}}>
          <option value="">현재 위치</option>{allDecks.filter(d=>d.id!==deck.id).map(d=><option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}</select></div>
        <div style={{display:'flex',gap:8}}><button className="btn btn-danger btn-full" onClick={()=>{onDeleteWord(editing.id);setEditing(null);}}>삭제</button>
          <button className="btn btn-primary btn-full" onClick={()=>{onUpdateWord(editing.id,{english:editing.english,korean:editing.korean,example:editing.example});setEditing(null);showToast('저장!');}}>저장</button></div>
      </div></div>}
      {showQuizOpt&&<div className="modal-overlay" onClick={()=>setShowQuizOpt(false)}><div className="modal-sheet" onClick={e=>e.stopPropagation()}>
        <div className="modal-handle" /><div className="modal-title">📝 퀴즈 설정</div>
        <div className="form-group"><label className="form-label">유형</label><div className="tab-pills">
          {['choice','spelling','cloze','writing'].map(m=><button key={m} className={`tab-pill ${quizMode===m?'active':''}`} onClick={()=>setQuizMode(m)}>{{choice:'객관식',spelling:'스펠링',cloze:'빈칸',writing:'문장'}[m]}</button>)}</div></div>
        <div className="form-group"><label className="form-label">방향</label><div className="tab-pills">
          <button className={`tab-pill ${quizDir==='e2k'?'active':''}`} onClick={()=>setQuizDir('e2k')}>영→한</button>
          <button className={`tab-pill ${quizDir==='k2e'?'active':''}`} onClick={()=>setQuizDir('k2e')}>한→영</button></div></div>
        <div className="form-group"><label className="form-label">문제 수</label><div className="tab-pills">
          {[10,20,50].map(n=><button key={n} className={`tab-pill ${quizCount===n?'active':''}`} onClick={()=>setQuizCount(n)}>{n>=50?'전체':n+'개'}</button>)}</div></div>
        <button className="btn btn-primary btn-full btn-lg mt-16" onClick={()=>{setShowQuizOpt(false);onQuiz(quizMode,quizDir,quizCount);}}>🚀 시작</button>
      </div></div>}
      {renaming&&<div className="modal-overlay" onClick={()=>setRenaming(false)}><div className="modal-sheet" onClick={e=>e.stopPropagation()}>
        <div className="modal-handle" /><div className="modal-title">✏️ 이름</div>
        <input className="form-input" value={renameTxt} onChange={e=>setRenameTxt(e.target.value)} autoFocus />
        <button className="btn btn-primary btn-full mt-16" onClick={()=>{if(renameTxt.trim())onRenameDeck(deck.id,renameTxt.trim());setRenaming(false);}}>변경</button>
      </div></div>}
    </div>);
}

// ── 플래시카드 [A1 recall prompt] ──
function StudyView({words,allWords,onBack,onUpdateWord,onLogStudy,autoTTS,recallPrompt}){
  const [sessionIdx,setSessionIdx]=useState(0);const [idx,setIdx]=useState(0);const [flipped,setFlipped]=useState(false);
  const [phase,setPhase]=useState('study');const [results,setResults]=useState([]);
  const [miniCards,setMiniCards]=useState([]);const [miniIdx,setMiniIdx]=useState(0);const [miniFlipped,setMiniFlipped]=useState(false);
  const [showBonus,setShowBonus]=useState(null);const [srsInfo,setSrsInfo]=useState(null);
  const [allCards,setAllCards]=useState(()=>mixDifficulty(words));const [sessionStartIdx,setSessionStartIdx]=useState(0);
  // [A1] recall prompt state
  const [recallReady,setRecallReady]=useState(!recallPrompt);

  const sessions=useMemo(()=>{const s=[];for(let i=0;i<allCards.length;i+=SESSION_SIZE)s.push(allCards.slice(i,i+SESSION_SIZE));return s;},[allCards]);
  const cards=sessions[sessionIdx]||[];const cur=cards[idx];
  useEffect(()=>{if(cur&&autoTTS&&!flipped&&phase==='study')speak(cur.english);},[idx,cur,autoTTS,flipped,phase]);
  // [A1] 새 카드마다 recallReady 리셋
  useEffect(()=>{if(recallPrompt)setRecallReady(false);},[idx,recallPrompt]);

  if(!allCards.length)return(<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button><span className="sub-header-title">없음</span></div>
    <div className="empty-state"><div className="empty-icon">✅</div><div className="empty-title">복습할 단어가 없어요</div><button className="btn btn-primary mt-16" onClick={onBack}>돌아가기</button></div></div>);
  if(phase==='allDone'){const known=results.filter(r=>r.q>=3).length;const wrong=results.filter(r=>r.q<3);
    return (<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button><span className="sub-header-title">완료!</span></div>
      <div className="quiz-result"><div className="quiz-result-icon">🎉</div><div className="quiz-result-score">{known}/{results.length}</div>
        <div className="quiz-result-label">{sessions.length}세션 완료</div>
        <div style={{display:'flex',gap:10,justifyContent:'center',marginTop:20}}><button className="btn btn-secondary" onClick={onBack}>돌아가기</button>
          {wrong.length>0&&<button className="btn btn-primary" onClick={()=>{const ww=wrong.map(r=>allCards.find(c=>c.id===r.id)).filter(Boolean);
            setAllCards(shuffle(ww));setSessionIdx(0);setIdx(0);setFlipped(false);setResults([]);setSessionStartIdx(0);setPhase('study');}}>😰 틀린 단어 ({wrong.length})</button>}
        </div></div></div>);}
  if(phase==='sessionEnd'){const sr=results.slice(sessionStartIdx);const sk=sr.filter(r=>r.q>=3).length;
    return (<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button><span className="sub-header-title">세션 {sessionIdx+1} 완료</span></div>
      <div className="quiz-result"><div className="quiz-result-icon">💪</div><div className="quiz-result-score">{sk}/{cards.length}</div>
        <div className="quiz-result-label">세션 {sessionIdx+1}/{sessions.length}</div>
        <div style={{fontSize:'0.85rem',color:'var(--text-tertiary)',margin:'12px 0'}}>잠깐 쉬고 다음으로!</div>
        <div style={{display:'flex',gap:10,justifyContent:'center'}}><button className="btn btn-secondary" onClick={onBack}>그만하기</button>
          <button className="btn btn-primary" onClick={()=>{setSessionStartIdx(results.length);setSessionIdx(s=>s+1);setIdx(0);setFlipped(false);setPhase('study');}}>다음 세션 →</button>
        </div></div></div>);}
  if(phase==='miniReview'){if(miniIdx>=miniCards.length){if(sessionIdx+1>=sessions.length){setPhase('allDone');return null;}else{setPhase('sessionEnd');return null;}}
    const mc=miniCards[miniIdx];
    return (<div><div className="sub-header"><button className="back-btn" onClick={()=>{if(sessionIdx+1>=sessions.length)setPhase('allDone');else setPhase('sessionEnd');}}>←</button>
      <span className="sub-header-title">🔁 즉시 복습</span><span style={{fontSize:'0.8rem',color:'var(--text-tertiary)'}}>{miniIdx+1}/{miniCards.length}</span></div>
      <div className="page-content"><div style={{textAlign:'center',fontSize:'0.8rem',color:'var(--warning)',marginBottom:12,fontWeight:600}}>방금 틀린 단어 한 번 더!</div>
        <div className="flashcard-container" onClick={()=>setMiniFlipped(!miniFlipped)}>
          <div className={`flashcard ${miniFlipped?'flipped':''}`}>
            <div className="flashcard-face flashcard-front" style={{background:'linear-gradient(135deg,#f59e0b,#ef4444)'}}><div className="flashcard-word">{mc.english}</div><div className="flashcard-hint">탭!</div></div>
            <div className="flashcard-face flashcard-back"><div className="flashcard-meaning">{mc.korean}</div></div></div></div>
        {miniFlipped&&<button className="btn btn-primary btn-full btn-lg mt-16" onClick={()=>{setMiniIdx(i=>i+1);setMiniFlipped(false);}}>{miniIdx+1>=miniCards.length?'완료':'다음 →'}</button>}
      </div></div>);}

  const finishCard=()=>{setShowBonus(null);setSrsInfo(null);
    if(idx+1>=cards.length){const sr=results.slice(sessionStartIdx);const wi=sr.filter(r=>r.q<3);
      const wc=cards.filter(c=>wi.some(r=>r.id===c.id)).slice(0,5);
      if(wc.length>0){setMiniCards(wc);setMiniIdx(0);setMiniFlipped(false);setPhase('miniReview');}
      else if(sessionIdx+1>=sessions.length)setPhase('allDone');else setPhase('sessionEnd');
    }else{setIdx(i=>i+1);setFlipped(false);}};

  const handleAnswer=quality=>{const srs=calcSRS(cur,quality);const update={srs};
    if(quality<3)update.wrongCount=(cur.wrongCount||0)+1;else update.correctCount=(cur.correctCount||0)+1;
    onUpdateWord(cur.id,update);onLogStudy(1);setResults(prev=>[...prev,{id:cur.id,q:quality}]);
    if(quality>=3){const sim=findSimilar(cur,allWords);const nd=srs.interval;
      if(sim.length>0){setShowBonus({word:cur,similar:sim,nextDays:nd});return;}
      if(nd>1){setSrsInfo(nd);setTimeout(()=>{setSrsInfo(null);finishCard();},1200);return;}}
    finishCard();};

  return (<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button>
    <span className="sub-header-title">세션 {sessionIdx+1}/{sessions.length}</span>
    <span style={{fontSize:'0.8rem',color:'var(--text-tertiary)'}}>{idx+1}/{cards.length}</span></div>
    <div className="page-content">
      <div className="quiz-progress-bar"><div className="quiz-progress-fill" style={{width:`${((idx+1)/cards.length)*100}%`}} /></div>
      {srsInfo&&<div className="srs-feedback">📅 다음 복습: {srsInfo}일 후</div>}
      {showBonus?(<div className="card" style={{textAlign:'center',padding:24,marginTop:16}}>
        <div style={{fontSize:'0.8rem',color:'var(--success)',fontWeight:600,marginBottom:8}}>✅ 정답! 보너스</div>
        <div style={{fontSize:'1.5rem',fontWeight:700,marginBottom:8}}>{showBonus.word.english}</div>
        {showBonus.nextDays>1&&<div className="srs-feedback" style={{margin:'8px 0'}}>📅 다음 복습: {showBonus.nextDays}일 후</div>}
        <div style={{fontSize:'0.85rem',color:'var(--text-secondary)',marginBottom:16}}><span style={{fontWeight:600}}>⚠️ 유사어:</span> {showBonus.similar.map(s=>s.english).join(', ')}</div>
        <button className="btn btn-primary btn-full" onClick={finishCard}>계속 →</button></div>
      ):(
        <>
          <div className="flashcard-container" onClick={()=>{if(recallPrompt&&!recallReady)return;setFlipped(!flipped);}}>
            <div className={`flashcard ${flipped?'flipped':''}`}>
              <div className="flashcard-face flashcard-front"><div className="flashcard-word">{cur?.english}</div>
                <button className="tts-btn" style={{position:'absolute',top:16,right:16,background:'rgba(255,255,255,0.2)',color:'#fff'}} onClick={e=>{e.stopPropagation();speak(cur?.english);}}>🔊</button>
                {/* [A1] recall prompt */}
                {recallPrompt&&!recallReady?<div className="recall-prompt">뜻을 떠올려 보세요!<br/><button className="btn btn-sm" style={{marginTop:8,background:'rgba(255,255,255,0.2)',color:'#fff',border:'1px solid rgba(255,255,255,0.3)'}} onClick={e=>{e.stopPropagation();setRecallReady(true);}}>떠올렸어요 👆</button></div>
                  :<div className="flashcard-hint">탭하여 뜻 보기</div>}</div>
              <div className="flashcard-face flashcard-back"><div className="flashcard-meaning">{cur?.korean||'뜻 미입력'}</div>
                {cur?.example&&<div className="flashcard-example">"{cur.example}"</div>}
                <div className="flashcard-hint">아래 버튼 선택</div></div></div></div>
          {flipped&&<div className="study-4btn">
            <button className="btn btn-s4 s4-fail" onClick={()=>handleAnswer(1)}>😵<br/><small>모름</small></button>
            <button className="btn btn-s4 s4-hard" onClick={()=>handleAnswer(2)}>🤔<br/><small>애매</small></button>
            <button className="btn btn-s4 s4-good" onClick={()=>handleAnswer(4)}>😊<br/><small>알아요</small></button>
            <button className="btn btn-s4 s4-easy" onClick={()=>handleAnswer(5)}>🤩<br/><small>완벽!</small></button></div>}</>)}
    </div></div>);
}

// ── 퀴즈 [A2 학습조언] ──
function QuizView({allWords,mode,direction,maxQ,onBack,onUpdateWord,onLogStudy,onRetryWrong,retryWords}){
  const [qIdx,setQIdx]=useState(0);const [questions,setQuestions]=useState([]);const [selected,setSelected]=useState(null);
  const [inputVal,setInputVal]=useState('');const [showResult,setShowResult]=useState(false);const [score,setScore]=useState(0);
  const [done,setDone]=useState(false);const [wrongList,setWrongList]=useState([]);const [selfGrade,setSelfGrade]=useState(null);
  useEffect(()=>{const pool=retryWords?.length>0?retryWords:allWords;const shuffled=shuffle(pool).slice(0,Math.min(maxQ,pool.length));
    if(mode==='choice'){setQuestions(shuffled.map(w=>({word:w,options:shuffle([w,...shuffle(allWords.filter(x=>x.id!==w.id)).slice(0,3)]),correct:w.id})));}
    else{setQuestions(shuffled.map(w=>({word:w})));}
  },[allWords,mode,maxQ,retryWords]);
  if(!questions.length)return null;const q=questions[qIdx];const isE2K=direction==='e2k';

  // [A2] 퀴즈 결과 + 학습 조언
  if(done)return(<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button><span className="sub-header-title">결과</span></div>
    <div className="quiz-result">
      <div className="quiz-result-icon">{score/questions.length>=0.8?'🏆':score/questions.length>=0.5?'👏':'💪'}</div>
      <div className="quiz-result-score">{score}/{questions.length}</div>
      <div className="quiz-result-label">{Math.round(score/questions.length*100)}점</div>
      <div className="study-advice">{getStudyAdvice(score,questions.length,wrongList,mode)}</div>
      <div style={{display:'flex',gap:10,justifyContent:'center',marginTop:16,flexWrap:'wrap'}}>
        <button className="btn btn-secondary" onClick={onBack}>돌아가기</button>
        {wrongList.length>0&&<button className="btn btn-primary" onClick={()=>onRetryWrong(wrongList)}>😰 틀린 단어 ({wrongList.length})</button>}</div>
      {wrongList.length>0&&<div style={{marginTop:20,textAlign:'left'}}><div style={{fontSize:'0.85rem',fontWeight:600,marginBottom:8}}>❌ 틀린 단어</div>
        {wrongList.map(w=><div key={w.id} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:'0.85rem',borderBottom:'1px solid var(--border)'}}>
          <span style={{fontWeight:600}}>{w.english}</span><span style={{color:'var(--text-tertiary)'}}>{w.korean}</span></div>)}</div>}
    </div></div>);

  const next=isCorrect=>{if(isCorrect)setScore(s=>s+1);else setWrongList(p=>[...p,q.word]);
    onUpdateWord(q.word.id,{srs:calcSRS(q.word,isCorrect?4:1),...(isCorrect?{correctCount:(q.word.correctCount||0)+1}:{wrongCount:(q.word.wrongCount||0)+1})});
    onLogStudy(1);setTimeout(()=>{if(qIdx+1>=questions.length)setDone(true);else{setQIdx(i=>i+1);setSelected(null);setInputVal('');setShowResult(false);setSelfGrade(null);}},mode==='writing'?300:1200);};

  // Cloze
  if(mode==='cloze'){const hasEx=q.word.example&&q.word.example.toLowerCase().includes(q.word.english.toLowerCase());
    const cloze=hasEx?q.word.example.replace(new RegExp(q.word.english.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'_____'):null;
    const hint=q.word.english[0]+'_'.repeat(q.word.english.length-1);
    return (<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button><span className="sub-header-title">빈칸 퀴즈</span>
      <span style={{fontSize:'0.8rem',color:'var(--text-tertiary)'}}>{qIdx+1}/{questions.length}</span></div>
      <div className="page-content"><div className="quiz-progress-bar"><div className="quiz-progress-fill" style={{width:`${((qIdx+1)/questions.length)*100}%`}} /></div>
        <div className="quiz-question">
          {cloze?(<><div className="quiz-prompt">빈칸에 들어갈 단어는?</div>
            <div style={{fontSize:'1.1rem',fontWeight:600,padding:16,background:'var(--bg-secondary)',borderRadius:'var(--radius-md)',margin:'12px 0',lineHeight:1.6}}>{cloze}</div>
            <div style={{fontSize:'0.8rem',color:'var(--text-tertiary)',marginBottom:12}}>뜻: {q.word.korean}</div></>
          ):(<><div className="quiz-prompt">이 뜻의 영단어는?</div><div className="quiz-word">{q.word.korean||'뜻 없음'}</div>
            <div style={{fontSize:'1rem',color:'var(--accent)',fontWeight:600,letterSpacing:2,marginBottom:12,fontFamily:'monospace'}}>💡 {hint}</div></>)}
          <div className="quiz-input-area"><input className="form-input" placeholder="영단어..." value={inputVal}
            onChange={e=>setInputVal(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!showResult&&inputVal.trim()){setShowResult(true);next(fuzzyMatch(inputVal,q.word.english)!=='wrong');}}}
            disabled={showResult} autoFocus /><button className="btn btn-primary" onClick={()=>{if(showResult||!inputVal.trim())return;setShowResult(true);next(fuzzyMatch(inputVal,q.word.english)!=='wrong');}}
            disabled={showResult||!inputVal.trim()}>확인</button></div>
          {showResult&&(()=>{const m=fuzzyMatch(inputVal,q.word.english);
            if(m==='exact')return <div className="quiz-feedback correct">✅ 정답!</div>;
            if(m==='close')return <div className="quiz-feedback correct">✅ 거의 정답! ({q.word.english})</div>;
            const diff=diffHighlight(inputVal,q.word.english);
            return <div className="quiz-feedback wrong"><div style={{fontWeight:600,marginBottom:4}}>❌ 오답</div>
              <div style={{fontSize:'1.1rem',fontFamily:'monospace'}}>정답: {diff.map((d,i)=><span key={i} style={{color:d.ok?'var(--success)':'var(--danger)',fontWeight:d.ok?400:800,textDecoration:d.ok?'none':'underline'}}>{d.ch}</span>)}</div></div>;
          })()}
        </div></div></div>);}

  // Writing
  if(mode==='writing')return (<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button><span className="sub-header-title">✍️ 문장</span>
    <span style={{fontSize:'0.8rem',color:'var(--text-tertiary)'}}>{qIdx+1}/{questions.length}</span></div>
    <div className="page-content"><div className="quiz-progress-bar"><div className="quiz-progress-fill" style={{width:`${((qIdx+1)/questions.length)*100}%`}} /></div>
      <div className="quiz-question"><div className="quiz-prompt">이 단어로 문장을 만들어보세요</div><div className="quiz-word">{q.word.english}</div>
        <div style={{fontSize:'0.85rem',color:'var(--text-tertiary)',marginBottom:12}}>뜻: {q.word.korean}</div>
        <textarea className="form-input" style={{minHeight:80,resize:'vertical'}} placeholder={`"${q.word.english}" 사용한 문장`} value={inputVal} onChange={e=>setInputVal(e.target.value)} disabled={selfGrade!==null} />
        {selfGrade===null&&inputVal.trim()&&<button className="btn btn-primary btn-full mt-16" onClick={()=>setSelfGrade('pending')}>✏️ 채점</button>}
        {selfGrade==='pending'&&<div style={{marginTop:16}}><div style={{fontSize:'0.85rem',fontWeight:600,marginBottom:8}}>맞나요?</div>
          <div style={{padding:12,background:'var(--bg-secondary)',borderRadius:'var(--radius-md)',marginBottom:12,fontSize:'0.9rem'}}>{inputVal}</div>
          <div style={{display:'flex',gap:8}}><button className="btn btn-danger btn-full" onClick={()=>{setSelfGrade('wrong');next(false);}}>❌ 틀림</button>
            <button className="btn btn-success btn-full" onClick={()=>{setSelfGrade('correct');next(true);}}>✅ 맞음</button></div></div>}
      </div></div></div>);

  // Choice / Spelling
  const qText=isE2K?q.word.english:(q.word.korean||'뜻 없음');const correctAnswer=isE2K?q.word.korean:q.word.english;
  const getOptText=opt=>isE2K?(opt.korean||'(뜻 없음)'):opt.english;
  return (<div><div className="sub-header"><button className="back-btn" onClick={onBack}>←</button>
    <span className="sub-header-title">{mode==='choice'?'객관식':'스펠링'} ({isE2K?'영→한':'한→영'})</span>
    <span style={{fontSize:'0.8rem',color:'var(--text-tertiary)'}}>{qIdx+1}/{questions.length}</span></div>
    <div className="page-content"><div className="quiz-progress-bar"><div className="quiz-progress-fill" style={{width:`${((qIdx+1)/questions.length)*100}%`}} /></div>
      <div className="quiz-question">{mode==='choice'?(<>
        <div className="quiz-prompt">{isE2K?'뜻은?':'단어는?'}</div><div className="quiz-word">{qText}</div>
        {isE2K&&<button className="tts-btn mb-16" onClick={()=>speak(q.word.english)} style={{margin:'0 auto 16px'}}>🔊</button>}
        <div className="quiz-options">{q.options.map(opt=>{let cls='quiz-option';
          if(showResult){if(opt.id===q.correct)cls+=' correct';else if(opt.id===selected)cls+=' wrong';cls+=' disabled';}
          return <button key={opt.id} className={cls} onClick={()=>{if(selected)return;setSelected(opt.id);setShowResult(true);next(opt.id===q.correct);}}>{getOptText(opt)}</button>;})}</div>
      </>):(<>
        <div className="quiz-prompt">{isE2K?'뜻을 입력하세요':'영단어를 입력하세요'}</div><div className="quiz-word">{qText}</div>
        <div className="quiz-input-area"><input className="form-input" placeholder={isE2K?'뜻...':'영단어...'} value={inputVal}
          onChange={e=>setInputVal(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!showResult&&inputVal.trim()){setShowResult(true);next(fuzzyMatch(inputVal,correctAnswer)!=='wrong');}}}
          disabled={showResult} autoFocus /><button className="btn btn-primary" onClick={()=>{if(showResult||!inputVal.trim())return;setShowResult(true);next(fuzzyMatch(inputVal,correctAnswer)!=='wrong');}}
          disabled={showResult||!inputVal.trim()}>확인</button></div>
        {showResult&&(()=>{const m=fuzzyMatch(inputVal,correctAnswer);
          if(m==='exact')return <div className="quiz-feedback correct">✅ 정답!</div>;
          if(m==='close')return <div className="quiz-feedback correct">✅ 거의 정답! ({correctAnswer})</div>;
          const diff=diffHighlight(inputVal,correctAnswer);
          return <div className="quiz-feedback wrong"><div style={{fontWeight:600,marginBottom:4}}>❌ 오답</div>
            <div style={{fontSize:'1.1rem',fontFamily:'monospace'}}>정답: {diff.map((d,i)=><span key={i} style={{color:d.ok?'var(--success)':'var(--danger)',fontWeight:d.ok?400:800,textDecoration:d.ok?'none':'underline'}}>{d.ch}</span>)}</div></div>;
        })()}</>)}
      </div></div></div>);
}

// ── 통계 [B3 정답률] ──
function StatsPage({studyLog,words,decks,dailyGoal}){
  const last7=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const key=d.toISOString().split('T')[0];
    last7.push({key,label:DAYS_KR[d.getDay()],value:studyLog[key]||0,isToday:i===0});}
  const maxVal=Math.max(...last7.map(d=>d.value),1);
  const totalStudied=Object.values(studyLog).reduce((a,b)=>a+b,0);
  const mastered=words.filter(w=>getSrsStatus(w)==='mastered').length;
  const weekTotal=last7.reduce((s,d)=>s+d.value,0);
  const worst=[...words].filter(w=>(w.wrongCount||0)>0).sort((a,b)=>(b.wrongCount||0)-(a.wrongCount||0)).slice(0,10);
  // [B3] 정답률 계산
  const totalCorrect=words.reduce((s,w)=>s+(w.correctCount||0),0);
  const totalWrong=words.reduce((s,w)=>s+(w.wrongCount||0),0);
  const totalAttempts=totalCorrect+totalWrong;
  const accuracy=totalAttempts>0?Math.round(totalCorrect/totalAttempts*100):0;

  return (
    <div className="page-content">
      <div className="stats-row">
        <div className="stat-item"><div className="stat-value">{totalStudied}</div><div className="stat-label">총 학습</div></div>
        <div className="stat-item"><div className="stat-value">{words.length}</div><div className="stat-label">전체</div></div>
        <div className="stat-item"><div className="stat-value">{mastered}</div><div className="stat-label">암기완료</div></div></div>
      {/* [B3] 정답률 */}
      {totalAttempts>0&&<div className="card" style={{padding:16}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:8,fontSize:'0.85rem'}}>
          <span style={{fontWeight:600}}>📊 전체 정답률</span>
          <span style={{fontWeight:700,color:accuracy>=70?'var(--success)':accuracy>=50?'var(--warning)':'var(--danger)'}}>{accuracy}%</span></div>
        <div className="deck-progress" style={{height:8}}><div className="deck-progress-bar" style={{width:`${accuracy}%`,background:accuracy>=70?'var(--success)':accuracy>=50?'var(--warning)':'var(--danger)'}} /></div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:'0.75rem',color:'var(--text-tertiary)',marginTop:6}}>
          <span>✅ {totalCorrect}회 정답</span><span>❌ {totalWrong}회 오답</span></div>
      </div>}
      <div className="card">
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
          <span className="card-title">📅 이번 주</span><span style={{fontSize:'0.85rem',fontWeight:700,color:'var(--accent)'}}>{weekTotal}개</span></div>
        <div className="chart-container"><div className="chart-bars">{last7.map(d=>(
          <div key={d.key} className="chart-bar-wrapper"><div className="chart-bar-value">{d.value||''}</div>
            <div className={`chart-bar ${d.isToday?'today':''}`} style={{height:`${Math.max(4,(d.value/maxVal)*100)}%`}} />
            <div className="chart-bar-label">{d.label}</div></div>))}</div></div></div>
      {worst.length>0&&<div className="card"><div className="card-title" style={{marginBottom:8}}>😰 어려운 단어</div>
        {worst.map((w,i)=>(<div key={w.id} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid var(--border)'}}>
          <span style={{width:22,textAlign:'center',fontSize:'0.75rem',color:'var(--text-tertiary)'}}>{i+1}</span>
          <span style={{flex:1,fontWeight:600,fontSize:'0.85rem'}}>{w.english}</span>
          <span style={{fontSize:'0.75rem',color:'var(--text-tertiary)'}}>{w.korean}</span>
          <span style={{fontSize:'0.75rem',color:'var(--danger)',fontWeight:600}}>✗{w.wrongCount}</span></div>))}</div>}
      {decks.length>0&&<div className="card"><div className="card-title" style={{marginBottom:8}}>📚 단어장별</div>
        {decks.map(dk=>{const dw=words.filter(w=>w.deckId===dk.id);const pct=dw.length?Math.round(dw.filter(w=>getSrsStatus(w)==='mastered').length/dw.length*100):0;
          return (<div key={dk.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            <span>{dk.emoji}</span><div style={{flex:1}}><div style={{fontSize:'0.8rem',fontWeight:600,marginBottom:2}}>{dk.name}</div>
              <div className="deck-progress" style={{height:5}}><div className="deck-progress-bar" style={{width:`${pct}%`}} /></div></div>
            <span style={{fontSize:'0.8rem',fontWeight:600}}>{pct}%</span></div>);})}</div>}
    </div>);
}

// ── 설정 ──
function SettingsPage({darkMode,setDarkMode,autoTTS,setAutoTTS,dailyGoal,setDailyGoal,recallPrompt,setRecallPrompt,words,decks,showToast,setWords,setDecks,setStudyLog}){
  const jsonRef=useRef(null);const csvRef=useRef(null);
  const exportCSV=()=>{if(!words.length){showToast('없어요');return;}
    const rows=[['영단어','뜻','예문','단어장','상태'].join(',')];
    words.forEach(w=>{const dn=decks.find(d=>d.id===w.deckId)?.name||'';rows.push([w.english,w.korean,w.example||'',dn,getSrsStatus(w)].map(c=>`"${c}"`).join(','));});
    const blob=new Blob(['\ufeff'+rows.join('\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`vocasnap_${getToday()}.csv`;a.click();showToast('CSV 완료!');};
  const exportJSON=()=>{const data={decks,words,exportDate:new Date().toISOString(),version:'4.2'};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`vocasnap_backup_${getToday()}.json`;a.click();showToast('백업 완료!');};
  const importJSON=e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const data=JSON.parse(ev.target.result);
    if(data.decks&&data.words){setDecks(data.decks);setWords(data.words);showToast(`${data.words.length}개 복원!`);}else alert('잘못된 파일');}catch{alert('실패');}};r.readAsText(f);e.target.value='';};
  const importCSV=e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{
    const lines=ev.target.result.split('\n').filter(l=>l.trim());if(lines.length<1){showToast('없음');return;}
    const dk={id:gid(),name:`CSV ${getToday()}`,emoji:'📥',createdAt:new Date().toISOString()};const imp=[];
    const fp=lines[0].match(/(".*?"|[^,\t;]+)/g);
    const isH=fp&&(fp[0].replace(/"/g,'').match(/^(영단어|english|word|단어|front)/i)||fp[1]?.replace(/"/g,'').match(/^(뜻|meaning|korean|definition|back)/i));
    for(let i=isH?1:0;i<lines.length;i++){let parts=lines[i].match(/(".*?"|[^,\t;]+)/g);
      if(parts?.length>=2){const eng=parts[0].replace(/"/g,'').trim(),kor=parts[1].replace(/"/g,'').trim(),ex=parts[2]?parts[2].replace(/"/g,'').trim():'';
        if(eng)imp.push({id:gid(),deckId:dk.id,english:eng,korean:kor,example:ex,starred:false,wrongCount:0,correctCount:0,introduced:false,srs:{},createdAt:new Date().toISOString()});}}
    if(imp.length){setDecks(p=>[dk,...p]);setWords(p=>[...p,...imp]);showToast(`${imp.length}개 가져오기!`);}else showToast('없음');
  }catch{showToast('실패');}};r.readAsText(f);e.target.value='';};

  return (
    <div className="page-content">
      <div className="card"><div className="card-title" style={{marginBottom:12}}>🎨 화면</div>
        <div className="setting-item"><div><div className="setting-label">다크 모드</div></div>
          <button className={`toggle ${darkMode?'on':'off'}`} onClick={()=>setDarkMode(!darkMode)} /></div>
        <div className="setting-item"><div><div className="setting-label">자동 발음</div><div className="setting-desc">플래시카드 TTS</div></div>
          <button className={`toggle ${autoTTS?'on':'off'}`} onClick={()=>setAutoTTS(!autoTTS)} /></div>
        <div className="setting-item"><div><div className="setting-label">떠올리기 유도</div><div className="setting-desc">카드 뒤집기 전 한 번 생각</div></div>
          <button className={`toggle ${recallPrompt?'on':'off'}`} onClick={()=>setRecallPrompt(!recallPrompt)} /></div></div>
      <div className="card"><div className="card-title" style={{marginBottom:12}}>🎯 일일 목표</div>
        <div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:'0.85rem'}}>하루</span>
          <input type="number" className="form-input" style={{width:80,textAlign:'center'}} value={dailyGoal} onChange={e=>setDailyGoal(Math.max(1,parseInt(e.target.value)||1))} min="1" />
          <span style={{fontSize:'0.85rem'}}>개</span></div></div>
      <div className="card"><div className="card-title" style={{marginBottom:12}}>💾 데이터</div>
        <button className="btn btn-secondary btn-full mb-8" onClick={exportCSV}>📄 CSV 내보내기</button>
        <button className="btn btn-secondary btn-full mb-8" onClick={exportJSON}>💾 JSON 백업</button>
        <button className="btn btn-secondary btn-full mb-8" onClick={()=>csvRef.current?.click()}>📥 CSV 가져오기</button>
        <button className="btn btn-secondary btn-full mb-8" onClick={()=>jsonRef.current?.click()}>📂 JSON 복원</button>
        <input ref={jsonRef} type="file" accept=".json" style={{display:'none'}} onChange={importJSON} />
        <input ref={csvRef} type="file" accept=".csv,.tsv,.txt" style={{display:'none'}} onChange={importCSV} />
        <button className="btn btn-danger btn-full" onClick={()=>{if(window.confirm('모든 데이터 삭제?')){setDecks([]);setWords([]);setStudyLog({});localStorage.clear();showToast('초기화!');}
        }}>🗑️ 초기화</button></div>
      <div className="card"><div className="card-title" style={{marginBottom:8}}>ℹ️ VocaSnap v4.2</div>
        <div style={{fontSize:'0.75rem',color:'var(--text-tertiary)',lineHeight:1.8}}>
          🚀 원터치학습 · 통합복습 · 떠올리기유도<br/>
          📝 빈칸힌트 · diff하이라이트 · 학습조언<br/>
          🔍 글로벌검색 · 일괄선택 · 정답률통계</div></div>
    </div>);
}

function ConfirmDialog({title,msg,onConfirm,onCancel}){
  return(<div className="confirm-dialog" onClick={onCancel}><div className="confirm-box" onClick={e=>e.stopPropagation()}>
    <div className="confirm-title">{title}</div><div className="confirm-msg">{msg}</div>
    <div className="confirm-actions"><button className="btn btn-secondary" onClick={onCancel}>취소</button><button className="btn btn-danger" onClick={onConfirm}>삭제</button></div>
  </div></div>);
}

export default App;