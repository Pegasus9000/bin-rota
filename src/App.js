import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, off } from "firebase/database";

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCbOVsNGt4x0JhuUHaeSlKvqIPAjiqo6-U",
  authDomain:        "bin-rota-24e1d.firebaseapp.com",
  databaseURL:       "https://bin-rota-24e1d-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "bin-rota-24e1d",
  storageBucket:     "bin-rota-24e1d.firebasestorage.app",
  messagingSenderId: "320651922770",
  appId:             "1:320651922770:web:74553923cf8ad573153e8b",
};

const DB_PATH           = "binrota/state";
const ADMIN_PIN         = "1997";
const REPORTS_TO_URGENT = 2;
const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif`;

const DEFAULT_STATE = {
  residents: [
    { id: 1, name: "Alex",   active: true },
    { id: 2, name: "Jamie",  active: true },
    { id: 3, name: "Sam",    active: true },
    { id: 4, name: "Jordan", active: true },
    { id: 5, name: "Riley",  active: true },
    { id: 6, name: "Morgan", active: true },
  ],
  history: [], alerts: [], schedule: { day: "Mon", frequencyDays: 7 },
};

const BIN_TYPES = [
  { id: "general",   label: "General Waste", emoji: "🗑️" },
  { id: "recycling", label: "Recycling",      emoji: "♻️" },
];
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

let _db = null;
function getDB() {
  if (!_db) { const app = initializeApp(FIREBASE_CONFIG); _db = getDatabase(app); }
  return _db;
}

function getTurnCount(history, personId) {
  // Count unique turns (by turnId) — excludes outOfTurn entries
  const rota = history.filter(h => !h.outOfTurn && h.personId === personId);
  return new Set(rota.map(h => h.turnId || h.id)).size;
}
function getNextPersonIndex(history, residents, forcedId=null) {
  if (forcedId !== null) {
    const fi = residents.findIndex(r => r.id === forcedId && r.active);
    if (fi >= 0) return fi;
  }
  const active = residents.filter((r) => r.active);
  if (!active.length) return -1;
  const counts = active.map((r) => ({ id: r.id, count: getTurnCount(history, r.id) }));
  counts.sort((a, b) => a.count - b.count);
  return residents.findIndex((r) => r.id === counts[0].id);
}

// Average turns of OTHER active residents (excluding the returning person)
function getGroupAverageExcluding(history, residents, excludeId) {
  const others = residents.filter(r => r.active && r.id !== excludeId);
  if (!others.length) return 0;
  const total = others.reduce((sum, r) => sum + getTurnCount(history, r.id), 0);
  return Math.floor(total / others.length);
}

// Add synthetic away-credit entries so returning person matches group average
function applyReturnFromAway(history, person, residents) {
  const avg = getGroupAverageExcluding(history, residents, person.id);
  const current = getTurnCount(history, person.id);
  const catchUp = Math.max(0, avg - current);
  if (catchUp === 0) return history;
  const now = Date.now();
  const entries = Array.from({length: catchUp}, (_, i) => ({
    id: now+i, turnId: now+i,
    personId: person.id, personName: person.name,
    binType: "away", awayCredit: true,
    date: new Date().toLocaleDateString("en-GB"), ts: now+i,
  }));
  return [...entries, ...history].slice(0, 100);
}

function getStreak(history, residentId) {
  if (!history.length) return 0;
  let streak = 0;
  for (const entry of history) {
    if (entry.personId === residentId) streak++; else break;
  }
  return streak;
}

function isOverdue(schedule, history) {
  if (!history.length) return false;
  return (Date.now() - history[0].ts) / (1000 * 60 * 60 * 24) > schedule.frequencyDays;
}

function Toggle({ checked, onChange, color }) {
  return (
    <div onClick={onChange} style={{ width:"44px", height:"26px", borderRadius:"13px", background:checked?color:"#ccc", position:"relative", cursor:"pointer", transition:"background 0.2s", flexShrink:0 }}>
      <div style={{ position:"absolute", top:"3px", left:checked?"21px":"3px", width:"20px", height:"20px", borderRadius:"50%", background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,0.3)", transition:"left 0.2s" }} />
    </div>
  );
}

function PinModal({ onSuccess, onCancel, T }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  function attempt() {
    if (pin === ADMIN_PIN) { onSuccess(); }
    else { setError(true); setPin(""); setTimeout(() => setError(false), 1500); }
  }
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}>
      <div style={{ background:T.bgCard, borderRadius:"20px", padding:"28px 24px", width:"100%", maxWidth:"320px", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize:"32px", textAlign:"center", marginBottom:"8px" }}>🔐</div>
        <div style={{ fontSize:"18px", fontWeight:"700", textAlign:"center", marginBottom:"4px", color:T.text }}>Admin Access</div>
        <div style={{ fontSize:"14px", color:T.textFaint, textAlign:"center", marginBottom:"20px" }}>Enter your PIN to manage residents</div>
        <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e)=>setPin(e.target.value)} onKeyDown={(e)=>{ if(e.key==="Enter") attempt(); if(e.key==="Escape") onCancel(); }} placeholder="Enter PIN" autoFocus
          style={{ width:"100%", background:T.bgInput, border:`2px solid ${error?"#ff3b30":T.border}`, borderRadius:"12px", padding:"12px 16px", color:T.text, fontSize:"20px", textAlign:"center", letterSpacing:"8px", marginBottom:"12px" }} />
        {error && <div style={{ fontSize:"13px", color:"#ff3b30", textAlign:"center", marginBottom:"10px" }}>Wrong PIN — try again</div>}
        <div style={{ display:"flex", gap:"10px" }}>
          <button className="btn" onClick={onCancel} style={{ flex:1, background:T.bgCard2, color:T.textMuted, padding:"12px", fontSize:"15px", border:`1px solid ${T.border}` }}>Cancel</button>
          <button className="btn" onClick={attempt} style={{ flex:1, background:T.currentAccent, color:"#fff", padding:"12px", fontSize:"15px", fontWeight:"700" }}>Unlock</button>
        </div>
      </div>
    </div>
  );
}

export default function BinRota() {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem("binrota-theme");
    if (saved) return saved === "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  // Show welcome screen on first ever visit to this device
  const [showWelcome, setShowWelcome] = useState(() => {
    return !localStorage.getItem("binrota-visited");
  });
  function toggleTheme() { setIsDark(v => { localStorage.setItem("binrota-theme", !v?"dark":"light"); return !v; }); }

  const T = isDark ? {
    bg:"#1c1c1e", bgCard:"#2c2c2e", bgCard2:"#3a3a3c", bgInput:"#1c1c1e",
    border:"#3a3a3c", text:"#ffffff", textMuted:"#aeaeb2", textFaint:"#636366", textVeryFaint:"#3a3a3c",
    currentBg:"#0d2818", currentBorder:"#1a5c35", currentAccent:"#30d158", currentAccentBg:"#0d3320",
    alertBg:"#2d0f0f", alertBorder:"#5c1a1a", alertText:"#ff453a", alertSubtext:"#bf4040",
    urgentBg:"#3d1a00", urgentBorder:"#ff6b00", urgentText:"#ff9500",
    overdueBg:"#2d1a00", overdueBorder:"#cc7a00", overdueText:"#ffb300",
    removeBtnText:"#ff453a", footerBorder:"#2c2c2e", footerText:"#48484a",
    syncActive:"#30d158", syncIdle:"#48484a", toggleColor:"#30d158", pillBg:"#3a3a3c",
    waGreen:"#25d366", waBg:"#0d2d1a", waBorder:"#1a5c35",
    adminBg:"#1a1a2e", adminBorder:"#3a3a6e", adminText:"#a0a0ff",
    streakGold:"#ffd60a", streakBg:"#2a2000",
  } : {
    bg:"#f2f2f7", bgCard:"#ffffff", bgCard2:"#f2f2f7", bgInput:"#ffffff",
    border:"#e5e5ea", text:"#000000", textMuted:"#6e6e73", textFaint:"#aeaeb2", textVeryFaint:"#d1d1d6",
    currentBg:"#f0fff4", currentBorder:"#34c759", currentAccent:"#34c759", currentAccentBg:"#d1f7dc",
    alertBg:"#fff2f2", alertBorder:"#ff3b30", alertText:"#ff3b30", alertSubtext:"#cc2f26",
    urgentBg:"#fff3e0", urgentBorder:"#ff6b00", urgentText:"#e65100",
    overdueBg:"#fffbea", overdueBorder:"#f59e0b", overdueText:"#b45309",
    removeBtnText:"#ff3b30", footerBorder:"#e5e5ea", footerText:"#c7c7cc",
    syncActive:"#34c759", syncIdle:"#d1d1d6", toggleColor:"#34c759", pillBg:"#e5e5ea",
    waGreen:"#25d366", waBg:"#f0fff8", waBorder:"#34c759",
    adminBg:"#f0f0ff", adminBorder:"#c0c0ff", adminText:"#5050cc",
    streakGold:"#f59e0b", streakBg:"#fffbea",
  };

  const [residents,setResidents]=useState(DEFAULT_STATE.residents);
  const [history,setHistory]=useState(DEFAULT_STATE.history);
  const [alerts,setAlerts]=useState(DEFAULT_STATE.alerts);
  const [schedule,setSchedule]=useState(DEFAULT_STATE.schedule);
  const [editingId,setEditingId]=useState(null);
  const [editingName,setEditingName]=useState("");
  const [addingName,setAddingName]=useState("");
  const [showAddForm,setShowAddForm]=useState(false);
  const [activeTab,setActiveTab]=useState("rota");
  const [connStatus,setConnStatus]=useState("connecting");
  const [justDone,setJustDone]=useState(null);
  const [doneCopied,setDoneCopied]=useState(false);
  const [nudgeCopied,setNudgeCopied]=useState(false);
  const [showWA,setShowWA]=useState(false);
  const [waCopied,setWaCopied]=useState(false);
  const [isAdmin,setIsAdmin]=useState(false);
  const [showPin,setShowPin]=useState(false);
  const [pendingAction,setPendingAction]=useState(null);
  const [showReportPicker,setShowReportPicker]=useState(null);
  const [showBinPicker,setShowBinPicker]=useState(false);
  const [showWhoAreYou,setShowWhoAreYou]=useState(false);
  // Skip confirmation: {person, binTypeIds} — shown when someone empties out of turn
  const [showSkipConfirm,setShowSkipConfirm]=useState(null);
  const [showHelp,setShowHelp]=useState(false);
  const [forcedCurrentId,setForcedCurrentId]=useState(null);
  const [showFairnessStats,setShowFairnessStats]=useState(false);

  const stateRef=useRef({residents,history,alerts,schedule});
  stateRef.current={residents,history,alerts,schedule};
  const lastWriteId=useRef(null);
  const justDoneTimer=useRef(null);

  useEffect(()=>{
    let db; try{db=getDB();}catch(e){setConnStatus("error");return;}
    const dbRef=ref(db,DB_PATH);
    const unsub=onValue(dbRef,(snapshot)=>{
      const data=snapshot.val();
      if(!data){setConnStatus("live");return;}
      // Only skip if this snapshot is OUR own last write — never skip a flatmate's update
      if(data._writeId && data._writeId===lastWriteId.current){
        setConnStatus("live");return;
      }
      if(Array.isArray(data.residents)&&data.residents.length>0)setResidents(data.residents);
      if(Array.isArray(data.history))setHistory(data.history);
      if(Array.isArray(data.alerts))setAlerts(data.alerts);
      if(data.schedule&&typeof data.schedule==="object")setSchedule(data.schedule);
      setConnStatus("live");
    },(e)=>{console.error(e);setConnStatus("error");});
    return()=>off(dbRef,"value",unsub);
  },[]); // eslint-disable-line

  useEffect(()=>()=>{if(justDoneTimer.current)clearTimeout(justDoneTimer.current)},[]);

  function saveState(patch){
    const next={...stateRef.current,...patch};
    const writeId=Math.random().toString(36).slice(2)+Date.now();
    lastWriteId.current=writeId;
    next._writeId=writeId;
    try{set(ref(getDB(),DB_PATH),next);}catch(e){lastWriteId.current=null;}
    if(patch.residents!==undefined)setResidents(patch.residents);
    if(patch.history!==undefined)setHistory(patch.history);
    if(patch.alerts!==undefined)setAlerts(patch.alerts);
    if(patch.schedule!==undefined)setSchedule(patch.schedule);
  }

  function requireAdmin(fn){if(isAdmin){fn();return;}setPendingAction(()=>fn);setShowPin(true);}
  function onPinSuccess(){setIsAdmin(true);setShowPin(false);if(pendingAction){pendingAction();setPendingAction(null);}}

  const currentPersonIdx=getNextPersonIndex(history,residents,forcedCurrentId);
  const currentPerson=currentPersonIdx>=0?residents[currentPersonIdx]:null;
  const activeResidents=residents.filter(r=>r.active);
  // Calculate upNext fairly — simulate current person having 1 more turn, then find who is next
  const upNext = (() => {
    if (!currentPerson || activeResidents.length < 2) return null;
    // Simulate history after current person empties
    const simHistory = [{id:-1, turnId:-1, personId: currentPerson.id}, ...history];
    const nextIdx = getNextPersonIndex(simHistory, residents, null);
    const next = nextIdx >= 0 ? residents[nextIdx] : null;
    // Make sure it is not the same person as current
    return next && next.id !== currentPerson.id ? next : null;
  })();
  const urgentAlerts=alerts.filter(a=>Array.isArray(a.reports)&&a.reports.length>=REPORTS_TO_URGENT);
  const overdue=isOverdue(schedule,history);

  function buildDoneMessage(personName,binLabel,upNextName){
    let msg=`✅ ${personName} just emptied the ${binLabel}! 🗑️`;
    if(upNextName)msg+=`\n⏭️ Next up: ${upNextName}`;
    return msg;
  }
  function buildNudgeMessage(){
    if(!currentPerson)return"";
    return `Hey ${currentPerson.name}! 👋 It's your turn to empty the bins. Collection day is ${schedule.day} — don't forget! 🗑️`;
  }
  function buildWAMessage(urgent){
    const np=currentPerson?.name||"?";const nu=upNext?.name||"?";
    const freq=schedule.frequencyDays===3?"every 3 days":schedule.frequencyDays===7?"every week":"every fortnight";
    let msg=`🗑️ *Bin Rota Update*\n\n`;
    if(urgent?.length)urgent.forEach(a=>{msg+=`🚨 *URGENT: ${a.binLabel} is FULL!*\nReported by: ${a.reports.join(", ")}\n\n`;});
    msg+=`👤 It's *${np}'s* turn to empty the bins\n⏭️ Up next: ${nu}\n\n📅 Collection: *${schedule.day}* (${freq})\n\n✅ Open the app and tap the bin once emptied.`;
    return msg;
  }
  function copyText(text,setCopied){navigator.clipboard.writeText(text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2500);}).catch(()=>{});}

  // Called with confirmed person + bin selection
  function doMarkEmptied(person, binTypeIds, outOfTurn=false){
    const turnId = Date.now();
    const newAlerts = alerts.filter(a => !binTypeIds.includes(a.binType));
    const entries = binTypeIds.map((binTypeId, i) => ({
      id: turnId + i, turnId,
      personId: person.id, personName: person.name,
      binType: binTypeId,
      date: new Date().toLocaleDateString("en-GB"),
      ts: turnId,
      ...(outOfTurn ? {outOfTurn: true} : {}),
    }));
    saveState({history:[...entries,...history].slice(0,100), alerts: newAlerts});
    clearForcedAfterEmpty();
    if(justDoneTimer.current)clearTimeout(justDoneTimer.current);
    setJustDone({binTypeIds, personName: person.name, upNextName: outOfTurn ? null : upNext?.name||null});
    setDoneCopied(false);
    justDoneTimer.current=setTimeout(()=>setJustDone(null),8000);
  }

  function clearForcedAfterEmpty(){ setForcedCurrentId(null); }

  // Add a synthetic skipped entry so rota advances past this person fairly
  function skipPersonTurn(person){
    const turnId=Date.now()+9999;
    const entry={id:turnId,turnId,personId:person.id,personName:person.name,
      binType:"skipped",skipped:true,date:new Date().toLocaleDateString("en-GB"),ts:turnId};
    saveState({history:[entry,...stateRef.current.history].slice(0,100)});
  }

  // Tap bin button — open pickers
  function handleBinTap(){
    if(!currentPerson) return;
    setShowBinPicker(true);
  }

  // Called after bin picker: check if tapper is current person or someone else
  function onBinPickerDone(binTypeIds){
    setShowBinPicker(false);
    if(!binTypeIds.length) return;
    // Ask who they are — always, so we know if it is out of turn
    setShowWhoAreYou({binTypeIds});
  }

  // Final step: person confirmed
  function onWhoAreYouDone(person, binTypeIds){
    setShowWhoAreYou(false);
    if(!person) return;
    const outOfTurn = currentPerson && person.id !== currentPerson.id;
    if(outOfTurn){
      // Ask if they want to skip the current person too
      doMarkEmptied(person, binTypeIds, true);
      setShowSkipConfirm({skippedPerson: currentPerson, coveredBy: person});
    } else {
      doMarkEmptied(person, binTypeIds, false);
    }
  }

  // Quick path for alert-based emptying (already know person = current)
  function markEmptied(binTypeId){
    if(!currentPerson) return;
    doMarkEmptied(currentPerson, [binTypeId], false);
  }
  function reportFull(binTypeId,reporterName){
    const bin=BIN_TYPES.find(b=>b.id===binTypeId);if(!bin)return;
    const existing=alerts.find(a=>a.binType===binTypeId);
    const name=reporterName||"Someone";
    if(existing){
      if(existing.reports?.includes(name))return;
      saveState({alerts:alerts.map(a=>a.binType===binTypeId?{...a,reports:[...(a.reports||[]),name]}:a)});
    }else{
      saveState({alerts:[...alerts,{id:Date.now(),binType:binTypeId,binLabel:bin.label,reports:[name],ts:Date.now()}]});
    }
  }
  function dismissAlert(binTypeId){saveState({alerts:alerts.filter(a=>a.binType!==binTypeId)});}
  function startEdit(r){setEditingId(r.id);setEditingName(r.name);}
  function cancelEdit(){setEditingId(null);setEditingName("");}
  function saveEdit(id){
    const t=editingName.trim();if(!t)return;
    saveState({residents:residents.map(r=>r.id===id?{...r,name:t}:r)});
    setEditingId(null);setEditingName("");
  }
  function toggleActive(id){
    const person = residents.find(r => r.id === id);
    const isReturning = person && !person.active; // was inactive, now going active
    const newResidents = residents.map(r => r.id===id ? {...r, active:!r.active} : r);
    if (isReturning) {
      // Bring their turn count up to group average so they slot in fairly
      const updatedHistory = applyReturnFromAway(history, person, newResidents);
      saveState({residents: newResidents, history: updatedHistory});
    } else {
      saveState({residents: newResidents});
    }
  }
  function deleteResident(id){
    if(editingId===id)cancelEdit();
    saveState({residents:residents.filter(r=>r.id!==id),history:history.filter(e=>e.personId!==id)});
  }
  function addResident(){
    const t=addingName.trim();if(!t)return;
    const newId=Math.max(0,...residents.map(r=>r.id))+1;
    saveState({residents:[...residents,{id:newId,name:t,active:true}]});
    setAddingName("");setShowAddForm(false);
  }

  function ReportPicker({binTypeId}){
    const bin=BIN_TYPES.find(b=>b.id===binTypeId);
    const existing=alerts.find(a=>a.binType===binTypeId);
    return(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
        <div style={{background:T.bgCard,borderRadius:"20px",padding:"24px",width:"100%",maxWidth:"320px",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
          <div style={{fontSize:"28px",textAlign:"center",marginBottom:"6px"}}>{bin?.emoji}</div>
          <div style={{fontSize:"17px",fontWeight:"700",textAlign:"center",marginBottom:"4px",color:T.text}}>Who are you?</div>
          <div style={{fontSize:"13px",color:T.textFaint,textAlign:"center",marginBottom:"16px"}}>Tap your name to report this bin as full</div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px",maxHeight:"240px",overflowY:"auto"}}>
            {residents.filter(r=>r.active).map(r=>{
              const already=existing?.reports?.includes(r.name);
              return(<button key={r.id} className="btn" disabled={already} onClick={()=>{reportFull(binTypeId,r.name);setShowReportPicker(null);}}
                style={{padding:"12px 16px",fontSize:"15px",fontWeight:"500",background:already?T.bgCard2:T.currentAccent,color:already?T.textFaint:"#fff",border:`1px solid ${already?T.border:T.currentAccent}`,textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                {r.name}{already&&<span style={{fontSize:"12px"}}>Reported ✓</span>}
              </button>);
            })}
          </div>
          <button className="btn" onClick={()=>setShowReportPicker(null)} style={{width:"100%",marginTop:"12px",background:T.bgCard2,color:T.textMuted,padding:"11px",fontSize:"14px",border:`1px solid ${T.border}`}}>Cancel</button>
        </div>
      </div>
    );
  }

  const cardStyle={background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:"16px",overflow:"hidden"};
  const sectionLabel={fontSize:"12px",fontWeight:"600",color:T.textFaint,letterSpacing:"0.3px",textTransform:"uppercase",marginBottom:"8px"};
  const statusDot=connStatus==="live"?T.syncActive:connStatus==="error"?"#ff453a":"#f0a500";
  const statusText=connStatus==="live"?"Live":connStatus==="error"?"Offline":"Connecting…";

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:FONT,transition:"background 0.25s,color 0.25s"}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:0;}
        .btn{cursor:pointer;border:none;font-family:${FONT};transition:opacity 0.12s,transform 0.1s;border-radius:10px;font-weight:500;}
        .btn:hover{opacity:0.78;}.btn:active{transform:scale(0.96);opacity:0.6;}.btn:disabled{opacity:0.35;cursor:not-allowed;transform:none;}
        input{outline:none;font-family:${FONT};}
        .fade-in{animation:fadeIn 0.25s ease;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        .alert-pulse{animation:alertPulse 2.5s infinite;}
        @keyframes alertPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,59,48,.25)}50%{box-shadow:0 0 0 7px rgba(255,59,48,0)}}
        .urgent-pulse{animation:urgentPulse 1.8s infinite;}
        @keyframes urgentPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,107,0,.3)}50%{box-shadow:0 0 0 9px rgba(255,107,0,0)}}
        .done-pop{animation:donePop 0.4s cubic-bezier(0.175,0.885,0.32,1.275);}
        @keyframes donePop{0%{transform:scale(0.9);opacity:0}60%{transform:scale(1.03)}100%{transform:scale(1);opacity:1}}
      `}</style>

      {showPin&&<PinModal onSuccess={onPinSuccess} onCancel={()=>{setShowPin(false);setPendingAction(null);}} T={T}/>}
      {showReportPicker&&<ReportPicker binTypeId={showReportPicker}/>}

      {/* WHICH BINS? PICKER */}
      {showBinPicker&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div style={{background:T.bgCard,borderRadius:"20px",padding:"24px",width:"100%",maxWidth:"320px",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:"28px",textAlign:"center",marginBottom:"6px"}}>🗑️</div>
            <div style={{fontSize:"17px",fontWeight:"700",textAlign:"center",marginBottom:"4px",color:T.text}}>Which bins did you empty?</div>
            <div style={{fontSize:"13px",color:T.textFaint,textAlign:"center",marginBottom:"16px"}}>Select all that apply</div>
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              <div style={{fontSize:"12px",color:T.textFaint,textAlign:"center",marginBottom:"6px",lineHeight:1.5}}>Select which bins you emptied.<br/>This counts as your turn in the rota.</div>
              <button className="btn" onClick={()=>onBinPickerDone(["general","recycling"])} style={{padding:"14px 16px",fontSize:"15px",fontWeight:"600",background:T.currentAccent,color:"#fff",border:"none",display:"flex",alignItems:"center",gap:"12px"}}>
                <span style={{fontSize:"22px"}}>🗑️♻️</span><span>Both bins</span>
              </button>
              <button className="btn" onClick={()=>onBinPickerDone(["general"])} style={{padding:"14px 16px",fontSize:"15px",fontWeight:"500",background:T.bgCard2,color:T.text,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:"12px"}}>
                <span style={{fontSize:"22px"}}>🗑️</span><span>General Waste only</span>
              </button>
              <button className="btn" onClick={()=>onBinPickerDone(["recycling"])} style={{padding:"14px 16px",fontSize:"15px",fontWeight:"500",background:T.bgCard2,color:T.text,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:"12px"}}>
                <span style={{fontSize:"22px"}}>♻️</span><span>Recycling only</span>
              </button>
            </div>
            <button className="btn" onClick={()=>setShowBinPicker(false)} style={{width:"100%",marginTop:"12px",background:T.bgCard2,color:T.textMuted,padding:"11px",fontSize:"14px",border:`1px solid ${T.border}`}}>Cancel</button>
          </div>
        </div>
      )}

      {/* WHO ARE YOU? PICKER */}
      {showWhoAreYou&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div style={{background:T.bgCard,borderRadius:"20px",padding:"24px",width:"100%",maxWidth:"320px",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:"28px",textAlign:"center",marginBottom:"6px"}}>👤</div>
            <div style={{fontSize:"17px",fontWeight:"700",textAlign:"center",marginBottom:"4px",color:T.text}}>Who are you?</div>
            <div style={{fontSize:"13px",color:T.textFaint,textAlign:"center",marginBottom:"16px"}}>
              {currentPerson ? `It's ${currentPerson.name}'s turn — are you them?` : "Select your name"}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"8px",maxHeight:"260px",overflowY:"auto"}}>
              {residents.filter(r=>r.active).map(r=>{
                const isCurrent = r.id === currentPerson?.id;
                return(
                  <button key={r.id} className="btn" onClick={()=>onWhoAreYouDone(r, showWhoAreYou.binTypeIds)}
                    style={{padding:"12px 16px",fontSize:"15px",fontWeight: isCurrent?"700":"500",background: isCurrent?T.currentAccent:T.bgCard2,color: isCurrent?"#fff":T.text,border:`1.5px solid ${isCurrent?T.currentAccent:T.border}`,textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    {r.name}
                    {isCurrent&&<span style={{fontSize:"12px",opacity:0.85}}>It's your turn ✓</span>}
                    {!isCurrent&&<span style={{fontSize:"12px",color:T.textFaint}}>Not your turn</span>}
                  </button>
                );
              })}
            </div>
            <button className="btn" onClick={()=>setShowWhoAreYou(false)} style={{width:"100%",marginTop:"12px",background:T.bgCard2,color:T.textMuted,padding:"11px",fontSize:"14px",border:`1px solid ${T.border}`}}>Cancel</button>
          </div>
        </div>
      )}

      {/* SKIP CONFIRM MODAL */}
      {showSkipConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div style={{background:T.bgCard,borderRadius:"20px",padding:"28px 24px",width:"100%",maxWidth:"340px",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:"36px",textAlign:"center",marginBottom:"8px"}}>⏭️</div>
            <div style={{fontSize:"17px",fontWeight:"700",textAlign:"center",color:T.text,marginBottom:"10px"}}>
              Skip {showSkipConfirm.skippedPerson.name}'s turn?
            </div>
            <div style={{fontSize:"14px",color:T.textMuted,textAlign:"center",lineHeight:"1.6",marginBottom:"20px"}}>
              <span style={{fontWeight:"600",color:T.text}}>{showSkipConfirm.coveredBy.name}</span> just emptied the bins,
              but it was <span style={{fontWeight:"600",color:T.text}}>{showSkipConfirm.skippedPerson.name}'s</span> turn.
              <br/><br/>Skip their turn so the rota stays fair?
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              <button className="btn" onClick={()=>{
                skipPersonTurn(showSkipConfirm.skippedPerson);
                setShowSkipConfirm(null);
              }} style={{padding:"14px",fontSize:"15px",fontWeight:"700",background:T.currentAccent,color:"#fff",border:"none"}}>
                ✅ Yes — skip their turn
              </button>
              <div style={{fontSize:"11px",color:T.textFaint,textAlign:"center",padding:"0 4px",lineHeight:1.5}}>
                Their turn counts as done and the rota moves forward.
              </div>
              <button className="btn" onClick={()=>setShowSkipConfirm(null)}
                style={{padding:"14px",fontSize:"15px",fontWeight:"500",background:T.bgCard2,color:T.textMuted,border:`1px solid ${T.border}`}}>
                No — keep {showSkipConfirm.skippedPerson.name} as current
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WELCOME / ONBOARDING MODAL */}
      {showWelcome&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:120,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div style={{background:T.bgCard,borderRadius:"24px",padding:"28px 24px",width:"100%",maxWidth:"360px",boxShadow:"0 24px 80px rgba(0,0,0,0.4)"}}>
            
            {/* Logo + title */}
            <div style={{textAlign:"center",marginBottom:"20px"}}>
              <div style={{fontSize:"52px",marginBottom:"8px"}}>🗑️</div>
              <div style={{fontSize:"22px",fontWeight:"800",color:T.text,letterSpacing:"-0.5px"}}>Bin Rota</div>
              <div style={{fontSize:"14px",color:T.textFaint,marginTop:"4px"}}>Your shared house bin schedule</div>
            </div>

            {/* Quick steps */}
            <div style={{display:"flex",flexDirection:"column",gap:"12px",marginBottom:"24px"}}>
              {[
                {icon:"👤",text:"Check whose turn it is on the Rota tab"},
                {icon:"✅",text:"Tap the green button after you empty a bin"},
                {icon:"🗑️",text:"Tap Report Full if a bin needs emptying"},
                {icon:"✈️",text:"Toggle yourself off if you go away"},
              ].map((item,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:"12px",background:T.bgCard2,borderRadius:"12px",padding:"12px 14px"}}>
                  <div style={{fontSize:"22px",flexShrink:0}}>{item.icon}</div>
                  <div style={{fontSize:"14px",color:T.text,lineHeight:"1.4"}}>{item.text}</div>
                </div>
              ))}
            </div>

            {/* Buttons */}
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              <button className="btn" onClick={()=>{
                localStorage.setItem("binrota-visited","1");
                setShowWelcome(false);
                setShowHelp(true);
              }} style={{padding:"14px",fontSize:"15px",fontWeight:"600",background:T.bgCard2,color:T.text,border:`1px solid ${T.border}`}}>
                📖 Show me the full guide
              </button>
              <button className="btn" onClick={()=>{
                localStorage.setItem("binrota-visited","1");
                setShowWelcome(false);
              }} style={{padding:"14px",fontSize:"15px",fontWeight:"700",background:T.currentAccent,color:"#fff",border:"none"}}>
                Got it — take me to the app ✓
              </button>
            </div>

            <div style={{fontSize:"11px",color:T.textFaint,textAlign:"center",marginTop:"14px",lineHeight:1.5}}>
              This will only show once. Tap ? in the header anytime to reopen the guide.
            </div>
          </div>
        </div>
      )}

      {/* HELP MODAL */}
      {showHelp&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:110,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={()=>setShowHelp(false)}>
          <div style={{background:T.bgCard,borderRadius:"24px 24px 0 0",padding:"24px 20px 40px",width:"100%",maxWidth:"480px",maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"20px"}}>
              <div style={{fontSize:"20px",fontWeight:"700",color:T.text}}>How to use Bin Rota</div>
              <button className="btn" onClick={()=>setShowHelp(false)} style={{background:T.bgCard2,border:`1px solid ${T.border}`,color:T.textMuted,padding:"6px 12px",fontSize:"15px"}}>✕</button>
            </div>
            {[
              {icon:"👤",title:"Whose turn is it?",body:"Open the Rota tab. The big green card shows whose turn it is. You can also see who is up next."},
              {icon:"✅",title:"I just emptied the bins",body:"Tap the big green button. It will ask which bins you emptied (one or both), then ask your name. Once confirmed, your turn is logged and the rota moves on automatically."},
              {icon:"🗑️",title:"The bin is full but not your turn",body:"Go to Bin Status and tap Report Full. Pick your name. If 2 people report the same bin, an urgent alert appears for everyone with a WhatsApp message ready to send."},
              {icon:"⏭️",title:"Someone emptied it but it was not their turn",body:"Select your name when asked. The app will ask if the person whose turn it was should be skipped — tap Yes to keep the rota fair."},
              {icon:"✈️",title:"Going away?",body:"Go to the Residents tab and toggle your name off. You will be skipped in the rota until you turn it back on."},
              {icon:"💬",title:"Send a WhatsApp reminder",body:"On the Rota tab, tap Nudge to send a message to the current person. Or tap WhatsApp Update to send the full rota status to the group."},
              {icon:"🔐",title:"Admin access",body:"Admin can add or remove people, manually set whose turn it is, view fairness stats, and reset the rota. Ask Yassine for the PIN."},
            ].map((step,i)=>(
              <div key={i} style={{display:"flex",gap:"14px",marginBottom:"20px",alignItems:"flex-start"}}>
                <div style={{fontSize:"26px",flexShrink:0,width:"36px",textAlign:"center",marginTop:"2px"}}>{step.icon}</div>
                <div>
                  <div style={{fontSize:"15px",fontWeight:"700",color:T.text,marginBottom:"4px"}}>{step.title}</div>
                  <div style={{fontSize:"14px",color:T.textMuted,lineHeight:"1.6"}}>{step.body}</div>
                </div>
              </div>
            ))}
            <div style={{marginTop:"4px",padding:"14px",background:T.bgCard2,borderRadius:"12px",fontSize:"12px",color:T.textFaint,textAlign:"center",lineHeight:1.6}}>
              The app syncs in real time — any change appears on everyone's phone instantly. ✅
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={{background:T.bgCard,borderBottom:`1px solid ${T.border}`,padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10}}>
        <div>
          <div style={{fontSize:"22px",fontWeight:"700",letterSpacing:"-0.5px"}}>Bin Rota</div>
          <div style={{fontSize:"13px",color:T.textFaint,marginTop:"1px"}}>{activeResidents.length} active · {residents.length-activeResidents.length} away</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
          <div style={{width:"8px",height:"8px",borderRadius:"50%",background:statusDot}}/>
          <div style={{fontSize:"12px",color:statusDot,fontWeight:"500"}}>{statusText}</div>
          <button className="btn" onClick={()=>setShowHelp(true)} style={{background:T.bgCard2,border:`1px solid ${T.border}`,padding:"5px 11px",fontSize:"15px",fontWeight:"700",color:T.textMuted,lineHeight:1}}>?</button>
          <button className="btn" onClick={toggleTheme} style={{background:T.bgCard2,border:`1px solid ${T.border}`,padding:"5px 10px",fontSize:"16px",lineHeight:1}}>{isDark?"☀️":"🌙"}</button>
          {isAdmin&&<button className="btn" onClick={()=>setIsAdmin(false)} style={{background:T.adminBg,border:`1px solid ${T.adminBorder}`,color:T.adminText,padding:"4px 10px",fontSize:"11px",fontWeight:"700"}}>ADMIN ✕</button>}
        </div>
      </div>

      {/* OVERDUE */}
      {overdue&&(
        <div style={{margin:"12px 16px 0",background:T.overdueBg,border:`1.5px solid ${T.overdueBorder}`,borderRadius:"14px",padding:"14px 16px",display:"flex",alignItems:"center",gap:"12px"}}>
          <div style={{fontSize:"24px"}}>⏰</div>
          <div>
            <div style={{fontSize:"14px",fontWeight:"700",color:T.overdueText}}>Bins overdue!</div>
            <div style={{fontSize:"12px",color:T.textMuted,marginTop:"2px"}}>More than {schedule.frequencyDays} days since last emptied</div>
          </div>
        </div>
      )}

      {/* URGENT ALERTS */}
      {urgentAlerts.length>0&&(
        <div style={{padding:"12px 16px 0"}}>
          {urgentAlerts.map(alert=>{
            const urgentMsg=buildWAMessage([alert]);
            return(
              <div key={alert.id} className="urgent-pulse fade-in" style={{background:T.urgentBg,border:`2px solid ${T.urgentBorder}`,borderRadius:"16px",padding:"16px",marginBottom:"10px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                  <div style={{fontSize:"28px"}}>🚨</div>
                  <div>
                    <div style={{fontSize:"16px",fontWeight:"800",color:T.urgentText}}>{alert.binLabel} — URGENT</div>
                    <div style={{fontSize:"13px",color:T.textMuted,marginTop:"2px"}}>{alert.reports.join(" & ")} reported this bin full</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:"8px"}}>
                  <button className="btn" onClick={()=>markEmptied(alert.binType)} style={{flex:1,background:T.currentAccent,color:"#fff",padding:"10px",fontSize:"13px",fontWeight:"700"}}>Done ✓</button>
                  <button className="btn" onClick={()=>copyText(urgentMsg,setWaCopied)} style={{flex:1,background:T.waGreen,color:"#fff",padding:"10px",fontSize:"13px",fontWeight:"700"}}>📋 Copy WA</button>
                  <a href={`https://wa.me/?text=${encodeURIComponent(urgentMsg)}`} target="_blank" rel="noreferrer" style={{flex:1,background:T.waGreen,color:"#fff",padding:"10px",fontSize:"13px",fontWeight:"700",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center",textDecoration:"none"}}>Send ↗</a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* REGULAR ALERTS */}
      {alerts.filter(a=>!urgentAlerts.includes(a)).map(alert=>(
        <div key={alert.id} className="alert-pulse fade-in" style={{margin:"12px 16px 0",background:T.alertBg,border:`1.5px solid ${T.alertBorder}`,borderRadius:"14px",padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
            <div style={{fontSize:"22px"}}>⚠️</div>
            <div>
              <div style={{fontSize:"15px",fontWeight:"700",color:T.alertText}}>{alert.binLabel} reported full</div>
              <div style={{fontSize:"12px",color:T.alertSubtext,marginTop:"2px"}}>By {alert.reports?.join(", ")} · {REPORTS_TO_URGENT-(alert.reports?.length||0)} more triggers urgent</div>
            </div>
          </div>
          <div style={{display:"flex",gap:"8px",flexShrink:0}}>
            <button className="btn" onClick={()=>markEmptied(alert.binType)} style={{background:T.alertText,color:"#fff",padding:"7px 14px",fontSize:"13px",fontWeight:"700"}}>Done ✓</button>
            <button className="btn" onClick={()=>dismissAlert(alert.binType)} style={{background:T.bgCard2,color:T.textMuted,padding:"7px 10px",fontSize:"17px"}}>×</button>
          </div>
        </div>
      ))}

      {/* TABS */}
      <div style={{display:"flex",padding:"12px 16px 0",gap:"4px"}}>
        {[["rota","Rota"],["residents","Residents"],["history","History"]].map(([id,lbl])=>(
          <button key={id} className="btn" onClick={()=>setActiveTab(id)} style={{padding:"7px 16px",fontSize:"14px",fontWeight:activeTab===id?"600":"400",background:activeTab===id?T.bgCard:"transparent",color:activeTab===id?T.text:T.textFaint,border:activeTab===id?`1px solid ${T.border}`:"1px solid transparent"}}>{lbl}</button>
        ))}
      </div>

      <div style={{padding:"16px"}}>

        {/* ROTA TAB */}
        {activeTab==="rota"&&(
          <div className="fade-in" style={{display:"flex",flexDirection:"column",gap:"16px"}}>

            {/* Admin: forced current person notice */}
            {forcedCurrentId&&isAdmin&&(
              <div style={{background:T.adminBg,border:`1px solid ${T.adminBorder}`,borderRadius:"12px",padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px"}}>
                <div style={{fontSize:"13px",color:T.adminText}}>🔐 Turn manually set by admin</div>
                <button className="btn" onClick={()=>setForcedCurrentId(null)} style={{background:"transparent",color:T.adminText,fontSize:"12px",fontWeight:"600",padding:"4px 8px",border:`1px solid ${T.adminBorder}`}}>Clear</button>
              </div>
            )}

            {currentPerson?(
              <div style={{background:T.currentBg,border:`1.5px solid ${T.currentBorder}`,borderRadius:"20px",padding:"20px 22px"}}>
                <div style={{fontSize:"12px",fontWeight:"600",color:T.currentAccent,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:"4px"}}>Current Turn</div>
                <div style={{fontSize:"36px",fontWeight:"700",letterSpacing:"-1px",color:T.text,marginBottom:"4px"}}>{currentPerson.name}</div>
                {upNext&&<div style={{fontSize:"13px",color:T.textFaint}}>Up next: <span style={{color:T.textMuted,fontWeight:"500"}}>{upNext.name}</span></div>}
              </div>
            ):(
              <div style={{...cardStyle,padding:"24px",textAlign:"center",color:T.textFaint,fontSize:"15px"}}>No active residents.</div>
            )}

            {/* Nudge message */}
            {currentPerson&&(
              <div style={{background:T.waBg,border:`1.5px solid ${T.waBorder}`,borderRadius:"14px",padding:"14px 16px"}}>
                <div style={{fontSize:"13px",fontWeight:"600",color:T.text,marginBottom:"8px"}}>💬 Nudge {currentPerson.name}</div>
                <div style={{fontSize:"13px",color:T.textMuted,background:isDark?"#0a1a0e":"#dcf8c6",borderRadius:"10px",padding:"10px 12px",marginBottom:"10px",lineHeight:"1.5",border:`1px solid ${isDark?"#1a4a22":"#b5e7a0"}`}}>{buildNudgeMessage()}</div>
                <div style={{display:"flex",gap:"8px"}}>
                  <button className="btn" onClick={()=>copyText(buildNudgeMessage(),setNudgeCopied)} style={{flex:1,background:nudgeCopied?T.currentAccent:T.waGreen,color:"#fff",padding:"9px",fontSize:"13px",fontWeight:"700",transition:"background 0.3s"}}>{nudgeCopied?"✅ Copied!":"📋 Copy Nudge"}</button>
                  <a href={`https://wa.me/?text=${encodeURIComponent(buildNudgeMessage())}`} target="_blank" rel="noreferrer" style={{flex:1,background:T.waGreen,color:"#fff",padding:"9px",fontSize:"13px",fontWeight:"700",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center",textDecoration:"none"}}>Send in WA ↗</a>
                </div>
              </div>
            )}

            {/* Bin buttons */}
            <div>
              <div style={sectionLabel}>✅ Tap when you empty a bin</div>
              <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
                {BIN_TYPES.map(bin=>{
                  const isDoneThis=justDone?.binTypeIds?.includes(bin.id);
                  const alert=alerts.find(a=>a.binType===bin.id);
                  const isFull=!!alert;
                  const isUrgent=isFull&&alert.reports?.length>=REPORTS_TO_URGENT;
                  if(isDoneThis){
                    const doneMsg=buildDoneMessage(justDone.personName,bin.label,justDone.upNextName);
                    return(
                      <div key={bin.id} className="done-pop fade-in" style={{background:T.currentAccentBg,border:`2px solid ${T.currentAccent}`,borderRadius:"18px",padding:"18px 20px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"14px",marginBottom:"14px"}}>
                          <div style={{fontSize:"44px"}}>✅</div>
                          <div>
                            <div style={{fontSize:"18px",fontWeight:"700",color:T.currentAccent}}>Done! Thanks 🙌</div>
                            <div style={{fontSize:"14px",color:T.textMuted,marginTop:"2px"}}>{bin.label} marked as emptied</div>
                          </div>
                        </div>
                        <div style={{background:isDark?"#0a1a0e":"#dcf8c6",borderRadius:"10px",padding:"10px 12px",fontSize:"13px",color:isDark?"#d0f0d8":"#111",whiteSpace:"pre-wrap",lineHeight:"1.5",marginBottom:"10px",border:`1px solid ${isDark?"#1a4a22":"#b5e7a0"}`}}>{doneMsg}</div>
                        <div style={{display:"flex",gap:"8px"}}>
                          <button className="btn" onClick={()=>copyText(doneMsg,setDoneCopied)} style={{flex:1,background:doneCopied?T.currentAccent:T.waGreen,color:"#fff",padding:"10px",fontSize:"13px",fontWeight:"700",transition:"background 0.3s"}}>{doneCopied?"✅ Copied!":"📋 Copy to WhatsApp"}</button>
                          <a href={`https://wa.me/?text=${encodeURIComponent(doneMsg)}`} target="_blank" rel="noreferrer" style={{flex:1,background:T.waGreen,color:"#fff",padding:"10px",fontSize:"13px",fontWeight:"700",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center",textDecoration:"none"}}>Send ↗</a>
                        </div>
                      </div>
                    );
                  }
                  return(
                    <button key={bin.id} className="btn" onClick={handleBinTap} disabled={!currentPerson} style={{width:"100%",borderRadius:"18px",border:"none",background:isUrgent?"linear-gradient(135deg,#ff6b00,#e65100)":isFull?"linear-gradient(135deg,#ff3b30,#c0392b)":isDark?"linear-gradient(135deg,#30d158,#28a745)":"linear-gradient(135deg,#34c759,#2dbe55)",display:"flex",alignItems:"center",overflow:"hidden",boxShadow:isFull?"0 4px 20px rgba(255,59,48,0.4)":"0 4px 20px rgba(52,199,89,0.35)"}}>
                      <div style={{width:"72px",height:"72px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"32px",background:"rgba(0,0,0,0.12)",flexShrink:0}}>{bin.emoji}</div>
                      <div style={{flex:1,textAlign:"left",paddingLeft:"16px"}}>
                        <div style={{fontSize:"11px",fontWeight:"600",color:"rgba(255,255,255,0.75)",textTransform:"uppercase",marginBottom:"2px"}}>{isUrgent?"🚨 URGENT — Tap to confirm":isFull?"⚠️ Reported Full — Tap to confirm":"Tap when emptied"}</div>
                        <div style={{fontSize:"19px",fontWeight:"700",color:"#fff"}}>{bin.label}</div>
                      </div>
                      <div style={{width:"56px",height:"72px",display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.1)",flexShrink:0,fontSize:"22px",color:"rgba(255,255,255,0.85)"}}>✓</div>
                    </button>
                  );
                })}
              </div>
              {currentPerson&&!justDone&&<div style={{fontSize:"12px",color:T.textFaint,textAlign:"center",marginTop:"10px"}}>{currentPerson.name}, it's your turn — tap the bin you just emptied</div>}
            </div>

            {/* Bin status cards */}
            <div>
              <div style={sectionLabel}>Bin Status</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                {BIN_TYPES.map(bin=>{
                  const alert=alerts.find(a=>a.binType===bin.id);
                  const isFull=!!alert;const isUrgent=isFull&&alert.reports?.length>=REPORTS_TO_URGENT;
                  const rc=alert?.reports?.length||0;
                  return(
                    <div key={bin.id} style={{background:isUrgent?T.urgentBg:isFull?T.alertBg:T.bgCard,border:`1.5px solid ${isUrgent?T.urgentBorder:isFull?T.alertBorder:T.border}`,borderRadius:"14px",padding:"14px",transition:"all 0.2s"}}>
                      <div style={{fontSize:"24px",marginBottom:"5px"}}>{bin.emoji}</div>
                      <div style={{fontSize:"14px",fontWeight:"600",marginBottom:"2px"}}>{bin.label}</div>
                      <div style={{fontSize:"12px",color:isUrgent?T.urgentText:isFull?T.alertText:T.currentAccent,fontWeight:"600",marginBottom:"10px"}}>{isUrgent?"🚨 URGENT":isFull?`⚠️ ${rc} report${rc>1?"s":""}`:"● OK"}</div>
                      {!isFull
                        ?<button className="btn" onClick={()=>{
                            if(window.confirm("Report " + bin.label + " as full?\n\nThis will alert everyone. Only confirm if the bin genuinely needs emptying."))
                              setShowReportPicker(bin.id);
                          }} style={{background:T.bgCard2,color:T.textMuted,padding:"7px",fontSize:"12px",width:"100%",border:`1px solid ${T.border}`}}>Report Full</button>
                        :<button className="btn" onClick={()=>markEmptied(bin.id)} style={{background:isUrgent?T.urgentText:T.alertText,color:"#fff",padding:"7px",fontSize:"12px",width:"100%",fontWeight:"700"}}>Mark Emptied</button>
                      }
                    </div>
                  );
                })}
              </div>
            </div>

            {/* WhatsApp general */}
            <div style={{background:T.waBg,border:`1.5px solid ${T.waBorder}`,borderRadius:"16px",padding:"16px 18px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                  <span style={{fontSize:"22px"}}>💬</span>
                  <div>
                    <div style={{fontSize:"15px",fontWeight:"600",color:T.text}}>WhatsApp Update</div>
                    <div style={{fontSize:"12px",color:T.textFaint,marginTop:"1px"}}>Send full rota status to group</div>
                  </div>
                </div>
                <button className="btn" onClick={()=>setShowWA(v=>!v)} style={{background:T.waGreen,color:"#fff",padding:"7px 14px",fontSize:"13px",fontWeight:"600"}}>{showWA?"Close":"Generate"}</button>
              </div>
              {showWA&&(
                <div className="fade-in" style={{marginTop:"14px"}}>
                  <div style={{background:isDark?"#0a1a0e":"#dcf8c6",borderRadius:"12px",padding:"14px 16px",fontSize:"13px",lineHeight:"1.65",color:isDark?"#d0f0d8":"#111",whiteSpace:"pre-wrap",marginBottom:"12px",border:`1px solid ${isDark?"#1a4a22":"#b5e7a0"}`}}>{buildWAMessage()}</div>
                  <div style={{display:"flex",gap:"8px"}}>
                    <button className="btn" onClick={()=>copyText(buildWAMessage(),setWaCopied)} style={{flex:1,background:waCopied?T.currentAccent:T.waGreen,color:"#fff",padding:"11px",fontSize:"14px",fontWeight:"700",transition:"background 0.3s"}}>{waCopied?"✅ Copied!":"📋 Copy"}</button>
                    <a href={`https://wa.me/?text=${encodeURIComponent(buildWAMessage())}`} target="_blank" rel="noreferrer" style={{flex:1,background:T.waGreen,color:"#fff",padding:"11px",fontSize:"14px",fontWeight:"700",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center",textDecoration:"none"}}>Open WhatsApp ↗</a>
                  </div>
                </div>
              )}
            </div>

            {/* Schedule */}
            <div>
              <div style={sectionLabel}>Collection Schedule</div>
              <div style={{...cardStyle,padding:"16px",display:"flex",flexDirection:"column",gap:"14px"}}>
                <div>
                  <div style={{fontSize:"13px",color:T.textFaint,marginBottom:"8px",fontWeight:"500"}}>Collection day</div>
                  <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
                    {DAYS.map(d=><button key={d} className="btn" onClick={()=>saveState({schedule:{...schedule,day:d}})} style={{padding:"6px 11px",fontSize:"13px",fontWeight:schedule.day===d?"600":"400",background:schedule.day===d?T.text:T.bgCard2,color:schedule.day===d?T.bg:T.textMuted,border:`1px solid ${schedule.day===d?T.text:T.border}`}}>{d}</button>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:"13px",color:T.textFaint,marginBottom:"8px",fontWeight:"500"}}>Frequency</div>
                  <div style={{display:"flex",gap:"6px"}}>
                    {[{v:3.5,l:"Twice/week"},{v:3,l:"3 days"},{v:7,l:"Weekly"},{v:14,l:"Fortnightly"}].map(opt=><button key={opt.v} className="btn" onClick={()=>saveState({schedule:{...schedule,frequencyDays:opt.v}})} style={{padding:"5px 10px",fontSize:"12px",fontWeight:schedule.frequencyDays===opt.v?"600":"400",background:schedule.frequencyDays===opt.v?T.text:T.bgCard2,color:schedule.frequencyDays===opt.v?T.bg:T.textMuted,border:`1px solid ${schedule.frequencyDays===opt.v?T.text:T.border}`}}>{opt.l}</button>)}
                  </div>
                </div>
                <div style={{fontSize:"13px",color:T.textFaint,background:T.bgCard2,borderRadius:"10px",padding:"10px 12px"}}>
                  📅 Every <span style={{color:T.text,fontWeight:"600"}}>{schedule.frequencyDays===3?"3 days":schedule.frequencyDays===7?"week":"fortnight"}</span> on <span style={{color:T.text,fontWeight:"600"}}>{schedule.day}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RESIDENTS TAB */}
        {activeTab==="residents"&&(
          <div className="fade-in" style={{display:"flex",flexDirection:"column",gap:"16px"}}>

            {/* Streak leaderboard */}
            {history.length>0&&(
              <div>
                <div style={sectionLabel}>🔥 Streak Leaderboard</div>
                <div style={cardStyle}>
                  {[...residents].sort((a,b)=>{
                    const sa=getStreak(history,a.id),sb=getStreak(history,b.id);
                    return sb-sa||history.filter(h=>h.personId===b.id).length-history.filter(h=>h.personId===a.id).length;
                  }).map((r,idx,arr)=>{
                    const streak=getStreak(history,r.id);
                    const total=history.filter(h=>h.personId===r.id).length;
                    const isTop=streak>0&&streak===getStreak(history,arr[0].id);
                    return(
                      <div key={r.id} style={{padding:"13px 16px",borderBottom:idx<arr.length-1?`1px solid ${T.border}`:"none",display:"flex",alignItems:"center",gap:"12px"}}>
                        <div style={{width:"34px",height:"34px",borderRadius:"50%",flexShrink:0,background:isTop?T.streakBg:T.bgCard2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px"}}>
                          {isTop?"🔥":r.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:"15px",fontWeight:"500",color:T.text}}>{r.name}</div>
                          <div style={{fontSize:"12px",color:T.textFaint,marginTop:"1px"}}>{total} total turn{total!==1?"s":""}</div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          {streak>0
                            ?<div style={{fontSize:"14px",fontWeight:"700",color:T.streakGold}}>{streak} 🔥</div>
                            :<div style={{fontSize:"13px",color:T.textVeryFaint}}>—</div>
                          }
                          <div style={{fontSize:"11px",color:T.textFaint}}>streak</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{fontSize:"11px",color:T.textFaint,textAlign:"center",marginTop:"6px"}}>🔥 = consecutive turns in a row</div>
              </div>
            )}

            {!isAdmin&&(
              <div style={{background:T.adminBg,border:`1px solid ${T.adminBorder}`,borderRadius:"14px",padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px"}}>
                <div>
                  <div style={{fontSize:"14px",fontWeight:"600",color:T.adminText}}>🔐 Admin only</div>
                  <div style={{fontSize:"12px",color:T.textFaint,marginTop:"2px"}}>Adding and removing people requires admin access</div>
                </div>
                <button className="btn" onClick={()=>requireAdmin(()=>{})} style={{background:T.adminText,color:"#fff",padding:"8px 16px",fontSize:"13px",fontWeight:"700",flexShrink:0}}>Unlock</button>
              </div>
            )}

            {/* Admin tools: fairness stats + reset */}
            {isAdmin&&(
              <div style={{display:"flex",gap:"8px"}}>
                <button className="btn" onClick={()=>setShowFairnessStats(v=>!v)}
                  style={{flex:1,padding:"11px",fontSize:"13px",fontWeight:"600",background:showFairnessStats?T.currentAccent:T.bgCard,color:showFairnessStats?"#fff":T.text,border:`1px solid ${showFairnessStats?T.currentAccent:T.border}`}}>
                  📊 {showFairnessStats?"Hide Stats":"Fairness Stats"}
                </button>
                <button className="btn" onClick={()=>requireAdmin(()=>{
                  if(window.confirm("Reset the whole rota? This clears all turns and history. Cannot be undone.")){
                    saveState({history:[],alerts:[]});
                    setForcedCurrentId(null);
                  }
                })} style={{flex:1,padding:"11px",fontSize:"13px",fontWeight:"600",background:T.bgCard,color:T.removeBtnText,border:`1.5px solid ${T.alertBorder}`}}>
                  🔁 Reset Rota
                </button>
              </div>
            )}

            {/* Fairness stats panel */}
            {showFairnessStats&&(
              <div className="fade-in" style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:"16px",overflow:"hidden"}}>
                <div style={{padding:"12px 16px",borderBottom:`1px solid ${T.border}`,fontSize:"13px",fontWeight:"700",color:T.text}}>📊 Turn Fairness</div>
                {[...residents].sort((a,b)=>{
                  const ta=getTurnCount(history,a.id),tb=getTurnCount(history,b.id);
                  return tb-ta;
                }).map((r,idx,arr)=>{
                  const turns=getTurnCount(history,r.id);
                  const lastEntry=history.filter(h=>h.personId===r.id&&!h.skipped)[0];
                  const maxTurns=getTurnCount(history,arr[0].id)||1;
                  const barWidth=Math.round((turns/maxTurns)*100);
                  return(
                    <div key={r.id} style={{padding:"12px 16px",borderBottom:idx<arr.length-1?`1px solid ${T.border}`:"none"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
                        <span style={{fontSize:"14px",fontWeight:"500",color:T.text}}>{r.name}{!r.active&&<span style={{fontSize:"11px",color:T.textFaint,marginLeft:"6px"}}>Away</span>}</span>
                        <span style={{fontSize:"13px",fontWeight:"700",color:T.currentAccent}}>{turns} turn{turns!==1?"s":""}</span>
                      </div>
                      <div style={{height:"6px",background:T.bgCard2,borderRadius:"3px",overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${barWidth}%`,background:T.currentAccent,borderRadius:"3px",transition:"width 0.4s"}}></div>
                      </div>
                      <div style={{fontSize:"11px",color:T.textFaint,marginTop:"4px"}}>Last: {lastEntry?.date||"Never"}</div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{display:"flex",gap:"10px"}}>
              {[{label:"Total",value:residents.length},{label:"Active",value:activeResidents.length,color:T.currentAccent},{label:"Away",value:residents.filter(r=>!r.active).length,color:T.textFaint}].map(stat=>(
                <div key={stat.label} style={{flex:1,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:"14px",padding:"12px 14px",textAlign:"center"}}>
                  <div style={{fontSize:"22px",fontWeight:"700",color:stat.color||T.text}}>{stat.value}</div>
                  <div style={{fontSize:"12px",color:T.textFaint,marginTop:"2px"}}>{stat.label}</div>
                </div>
              ))}
            </div>

            {isAdmin&&(
              <>
                <button className="btn" onClick={()=>{setShowAddForm(v=>!v);setAddingName("");}} style={{width:"100%",padding:"13px",fontSize:"15px",fontWeight:"600",background:showAddForm?T.bgCard2:T.currentAccent,color:showAddForm?T.textMuted:"#fff",border:`1px solid ${showAddForm?T.border:T.currentAccent}`}}>
                  {showAddForm?"Cancel":"+ Add Person"}
                </button>
                {showAddForm&&(
                  <div className="fade-in" style={{display:"flex",gap:"8px"}}>
                    <input type="text" value={addingName} onChange={e=>setAddingName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addResident();if(e.key==="Escape"){setShowAddForm(false);setAddingName("");}}} placeholder="Enter name…" autoFocus style={{flex:1,background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"10px 14px",color:T.text,fontSize:"15px"}}/>
                    <button className="btn" onClick={addResident} style={{background:T.currentAccent,color:"#fff",padding:"10px 20px",fontSize:"15px",fontWeight:"600"}}>Add</button>
                  </div>
                )}
              </>
            )}

            <div style={cardStyle}>
              {residents.length===0&&<div style={{padding:"28px",textAlign:"center",color:T.textFaint,fontSize:"14px"}}>No residents yet.</div>}
              {residents.map((r,idx)=>{
                const isCurrent=r.id===currentPerson?.id;
                const turnCount=history.filter(h=>h.personId===r.id).length;
                return(
                  <div key={r.id} style={{padding:"14px 16px",borderBottom:idx<residents.length-1?`1px solid ${T.border}`:"none",display:"flex",alignItems:"center",gap:"12px",opacity:r.active?1:0.45,transition:"opacity 0.2s"}}>
                    <div style={{width:"38px",height:"38px",borderRadius:"50%",flexShrink:0,background:isCurrent&&r.active?T.currentAccentBg:T.bgCard2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",fontWeight:"700",color:isCurrent&&r.active?T.currentAccent:T.textFaint}}>
                      {r.name.charAt(0).toUpperCase()}
                    </div>
                    {editingId===r.id?(
                      <input type="text" value={editingName} onChange={e=>setEditingName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveEdit(r.id);if(e.key==="Escape")cancelEdit();}} autoFocus style={{flex:1,background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"6px 10px",color:T.text,fontSize:"15px"}}/>
                    ):(
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}}>
                          <span style={{fontSize:"15px",fontWeight:"500"}}>{r.name}</span>
                          {isCurrent&&r.active&&<span style={{fontSize:"11px",background:T.currentAccentBg,color:T.currentAccent,padding:"1px 7px",borderRadius:"20px",fontWeight:"600"}}>Current</span>}
                          {!r.active&&<span style={{fontSize:"11px",background:T.pillBg,color:T.textFaint,padding:"1px 7px",borderRadius:"20px",fontWeight:"500"}}>Away ✈️</span>}
                        </div>
                        <div style={{fontSize:"12px",color:T.textFaint,marginTop:"1px"}}>{turnCount} turn{turnCount!==1?"s":""}</div>
                      </div>
                    )}
                    {editingId===r.id?(
                      <div style={{display:"flex",gap:"6px"}}>
                        <button className="btn" onClick={()=>saveEdit(r.id)} style={{background:T.currentAccent,color:"#fff",padding:"6px 14px",fontSize:"13px",fontWeight:"600"}}>Save</button>
                        <button className="btn" onClick={cancelEdit} style={{background:T.bgCard2,color:T.textMuted,padding:"6px 10px",fontSize:"16px",border:`1px solid ${T.border}`}}>✕</button>
                      </div>
                    ):(
                      <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                        <Toggle checked={r.active} onChange={()=>toggleActive(r.id)} color={T.toggleColor}/>
                        {isAdmin&&<>
                          <button className="btn" onClick={()=>startEdit(r)} style={{background:"transparent",color:T.textFaint,padding:"4px",fontSize:"17px",border:"none"}}>✏️</button>
                          <button className="btn" onClick={()=>deleteResident(r.id)} style={{background:"transparent",color:T.removeBtnText,padding:"4px",fontSize:"17px",border:"none",opacity:0.6}}>🗑️</button>
                          <button className="btn" onClick={()=>setForcedCurrentId(forcedCurrentId===r.id?null:r.id)}
                            title="Set as current person"
                            style={{background:forcedCurrentId===r.id?T.currentAccent:"transparent",color:forcedCurrentId===r.id?"#fff":T.currentAccent,padding:"4px 8px",fontSize:"13px",fontWeight:"700",border:`1px solid ${T.currentAccent}`,borderRadius:"8px"}}>
                            {forcedCurrentId===r.id?"★ Current":"☆"}
                          </button>
                        </>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{fontSize:"12px",color:T.textFaint,textAlign:"center",lineHeight:1.5}}>Toggle the switch to mark someone as away.<br/>They'll be skipped in the rota until you turn them back on.</div>
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab==="history"&&(
          <div className="fade-in" style={{display:"flex",flexDirection:"column",gap:"16px"}}>

            {/* Clear history — admin only */}
            {history.length>0&&(
              <button className="btn" onClick={()=>requireAdmin(()=>{
                if(window.confirm("Are you sure you want to delete all history? This cannot be undone.")) saveState({history:[]});
              })} style={{width:"100%",padding:"12px",fontSize:"14px",fontWeight:"600",background:T.bgCard,color:T.removeBtnText,border:`1.5px solid ${T.alertBorder}`,display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}}>
                🗑️ Clear All History {!isAdmin&&<span style={{fontSize:"12px",color:T.textFaint,fontWeight:"400"}}>(admin)</span>}
              </button>
            )}

            <div>
              <div style={sectionLabel}>Emptying Log</div>
              {history.length===0?(
                <div style={{textAlign:"center",padding:"60px 20px",color:T.textVeryFaint,fontSize:"15px",lineHeight:1.6}}>No history yet.<br/>Tap a bin button to start the log.</div>
              ):(
                <div style={cardStyle}>
                  {history.map((h,idx)=>{
                    const bin=BIN_TYPES.find(b=>b.id===h.binType);
                    return(
                      <div key={h.id} style={{padding:"13px 16px",borderBottom:idx<history.length-1?`1px solid ${T.border}`:"none",display:"flex",alignItems:"center",gap:"12px"}}>
                        <div style={{fontSize:"22px"}}>{h.skipped?"⏭️":h.awayCredit?"✈️":h.outOfTurn?"🙌":bin?.emoji||"🗑️"}</div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:"15px"}}><span style={{fontWeight:"600"}}>{h.personName}</span><span style={{color:T.textMuted}}>{h.skipped?" — turn skipped":h.awayCredit?" — was away (catch-up)":h.outOfTurn?" covered (not their turn)":`emptied ${bin?.label||h.binType}`}</span></div>
                          <div style={{fontSize:"12px",color:T.textFaint,marginTop:"2px"}}>{h.date}</div>
                        </div>
                        <div style={{width:"8px",height:"8px",borderRadius:"50%",background:T.currentAccent,opacity:0.5,flexShrink:0}}/>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{textAlign:"center",padding:"24px 20px 32px",borderTop:`1px solid ${T.footerBorder}`,marginTop:"8px"}}>
        <div style={{fontSize:"12px",color:T.footerText,marginBottom:"6px"}}>Real-time sync · data stored securely in Firebase · <span style={{fontWeight:"600"}}>v2.2</span></div>
        <div style={{fontSize:"13px",color:T.textFaint}}>Made with ♥ by <span style={{color:T.currentAccent,fontWeight:"600"}}>Yassine</span></div>
      </div>
    </div>
  );
}
