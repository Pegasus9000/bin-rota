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

const DB_PATH           = "binrota";
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
  history: [], alerts: [], schedule: { day: "Mon" },
  forcedCurrentId: null, forcedNextId: null,
};

const BIN_TYPES = [
  { id: "general",   label: "General Waste", emoji: "🗑️" },
  { id: "recycling", label: "Recycling",      emoji: "♻️" },
];

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const _app = initializeApp(FIREBASE_CONFIG);
const _db  = getDatabase(_app);
function getDB() { return _db; }

// ── Turn counting: only real empties count toward rota fairness ──
function getTurnCount(history, personId) {
  const rota = history.filter(h =>
    h.personId === personId && !h.outOfTurn && !h.awayCredit && !h.skipped
  );
  return new Set(rota.map(h => h.turnId || h.id)).size;
}

function getNextPersonIndex(history, residents, forcedId = null) {
  if (forcedId !== null) {
    const fi = residents.findIndex(r => r.id === forcedId && r.active);
    if (fi >= 0) return fi;
  }
  const active = residents.filter(r => r.active);
  if (!active.length) return -1;
  const counts = active.map(r => ({ id: r.id, count: getTurnCount(history, r.id) }));
  counts.sort((a, b) => a.count - b.count);
  return residents.findIndex(r => r.id === counts[0].id);
}

function getGroupAverageExcluding(history, residents, excludeId) {
  const others = residents.filter(r => r.active && r.id !== excludeId);
  if (!others.length) return 0;
  const total = others.reduce((sum, r) => sum + getTurnCount(history, r.id), 0);
  return Math.floor(total / others.length);
}

function applyReturnFromAway(history, person, residents) {
  const avg = getGroupAverageExcluding(history, residents, person.id);
  const current = getTurnCount(history, person.id);
  const catchUp = Math.max(0, avg - current);
  if (catchUp === 0) return history;
  const now = Date.now();
  const entries = Array.from({ length: catchUp }, (_, i) => ({
    id: now + i, turnId: now + i,
    personId: person.id, personName: person.name,
    binType: "away", awayCredit: true,
    date: new Date().toLocaleDateString("en-GB"), ts: now + i,
  }));
  return [...entries, ...history].slice(0, 100);
}

function isOverdue(history) {
  if (!history.length) return false;
  return (Date.now() - history[0].ts) / (1000 * 60 * 60 * 24) > 7;
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
    if (pin === ADMIN_PIN) onSuccess();
    else { setError(true); setPin(""); setTimeout(() => setError(false), 1500); }
  }
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}>
      <div style={{ background:T.bgCard, borderRadius:"20px", padding:"28px 24px", width:"100%", maxWidth:"320px", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize:"32px", textAlign:"center", marginBottom:"8px" }}>🔐</div>
        <div style={{ fontSize:"18px", fontWeight:"700", textAlign:"center", marginBottom:"4px", color:T.text }}>Admin Access</div>
        <div style={{ fontSize:"14px", color:T.textFaint, textAlign:"center", marginBottom:"20px" }}>Enter your PIN</div>
        <input type="password" inputMode="numeric" maxLength={6} value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => { if(e.key==="Enter") attempt(); if(e.key==="Escape") onCancel(); }}
          placeholder="••••" autoFocus
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
    try { const s = localStorage.getItem("binrota-theme"); if (s) return s === "dark"; } catch(e) {}
    return false;
  });
  function toggleTheme() {
    setIsDark(v => { try { localStorage.setItem("binrota-theme", !v?"dark":"light"); } catch(e) {} return !v; });
  }

  const [showWelcome, setShowWelcome] = useState(() => {
    try { return !localStorage.getItem("binrota-visited"); } catch(e) { return false; }
  });

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

  // State
  const [residents, setResidents] = useState(DEFAULT_STATE.residents);
  const [history,   setHistory]   = useState(DEFAULT_STATE.history);
  const [alerts,    setAlerts]    = useState(DEFAULT_STATE.alerts);
  const [schedule,  setSchedule]  = useState(DEFAULT_STATE.schedule);
  const [forcedCurrentId, setForcedCurrentId] = useState(null);
  const [forcedNextId,    setForcedNextId]    = useState(null);

  const [editingId,   setEditingId]   = useState(null);
  const [editingName, setEditingName] = useState("");
  const [addingName,  setAddingName]  = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTab,   setActiveTab]   = useState("rota");
  const [connStatus,  setConnStatus]  = useState("connecting");
  const [justDone,    setJustDone]    = useState(null);
  const [doneCopied,  setDoneCopied]  = useState(false);
  const [waCopied,    setWaCopied]    = useState(false);

  // Modals
  const [isAdmin,             setIsAdmin]             = useState(false);
  const [showPin,             setShowPin]             = useState(false);
  const [pendingAction,       setPendingAction]       = useState(null);
  const [showReportPicker,    setShowReportPicker]    = useState(null);
  const [showReportWA,        setShowReportWA]        = useState(null);
  const [reportWACopied,      setReportWACopied]      = useState(false);
  const [showBinPicker,       setShowBinPicker]       = useState(null); // binTypeId
  const [showWhoAreYou,       setShowWhoAreYou]       = useState(null);
  const [showSkipConfirm,     setShowSkipConfirm]     = useState(null);
  const [showConfirm,         setShowConfirm]         = useState(null);
  const [showHelp,            setShowHelp]            = useState(false);
  const [showFairnessStats,   setShowFairnessStats]   = useState(false);
  const [showWA,              setShowWA]              = useState(false);

  const stateRef = useRef({ residents, history, alerts, schedule, forcedCurrentId, forcedNextId });
  stateRef.current = { residents, history, alerts, schedule, forcedCurrentId, forcedNextId };
  const lastWriteId   = useRef(null);
  const justDoneTimer = useRef(null);

  // Firebase — direct connection, no auth
  useEffect(() => {
    let db;
    try { db = getDB(); } catch(e) { setConnStatus("error"); return; }
    const dbRef = ref(db, DB_PATH + "/state");
    const unsub = onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) { setConnStatus("live"); return; }
      if (data._writeId && data._writeId === lastWriteId.current) {
        setConnStatus("live"); return;
      }
      if (Array.isArray(data.residents) && data.residents.length > 0) setResidents(data.residents);
      if (Array.isArray(data.history))  setHistory(data.history);
      if (Array.isArray(data.alerts))   setAlerts(data.alerts);
      if (data.schedule && typeof data.schedule === "object") setSchedule(data.schedule);
      setForcedCurrentId(data.forcedCurrentId ?? null);
      setForcedNextId(data.forcedNextId ?? null);
      setConnStatus("live");
    }, (e) => { console.error(e); setConnStatus("error"); });
    return () => off(dbRef, "value", unsub);
  }, []);

  useEffect(() => () => { if (justDoneTimer.current) clearTimeout(justDoneTimer.current); }, []);

  function saveState(patch) {
    const next = { ...stateRef.current, ...patch };
    const writeId = Math.random().toString(36).slice(2) + Date.now();
    lastWriteId.current = writeId;
    next._writeId = writeId;
    try { set(ref(getDB(), DB_PATH + "/state"), next); } catch(e) { lastWriteId.current = null; }
    if (patch.residents !== undefined) setResidents(patch.residents);
    if (patch.history   !== undefined) setHistory(patch.history);
    if (patch.alerts    !== undefined) setAlerts(patch.alerts);
    if (patch.schedule  !== undefined) setSchedule(patch.schedule);
    if (patch.forcedCurrentId !== undefined) setForcedCurrentId(patch.forcedCurrentId);
    if (patch.forcedNextId    !== undefined) setForcedNextId(patch.forcedNextId);
  }

  function onPinSuccess() {
    setIsAdmin(true); setShowPin(false);
    if (pendingAction) { pendingAction(); setPendingAction(null); }
  }

  // Derived
  const currentPersonIdx = getNextPersonIndex(history, residents, forcedCurrentId);
  const currentPerson    = currentPersonIdx >= 0 ? residents[currentPersonIdx] : null;
  const activeResidents  = residents.filter(r => r.active);
  const upNext = (() => {
    if (!currentPerson || activeResidents.length < 2) return null;
    if (forcedNextId !== null) {
      const forced = residents.find(r => r.id === forcedNextId && r.active);
      if (forced && forced.id !== currentPerson.id) return forced;
    }
    const simHistory = [{ id:-1, turnId:-1, personId: currentPerson.id }, ...history];
    const nextIdx = getNextPersonIndex(simHistory, residents, null);
    const next = nextIdx >= 0 ? residents[nextIdx] : null;
    return next && next.id !== currentPerson.id ? next : null;
  })();
  const urgentAlerts = alerts.filter(a => Array.isArray(a.reports) && a.reports.length >= REPORTS_TO_URGENT);
  const overdue = isOverdue(history);

  // Messages
  function buildDoneMessage(personName, binLabel, upNextName) {
    let msg = `✅ ${personName} just emptied the ${binLabel}! 🗑️`;
    if (upNextName) msg += `\n⏭️ Next up: ${upNextName}`;
    msg += `\n🔗 https://bin-rota.vercel.app`;
    return msg;
  }
  function buildWAMessage(urgent) {
    const np = currentPerson?.name || "?";
    const nu = upNext?.name || "?";
    let msg = `🗑️ *Bin Rota Update*\n\n`;
    if (urgent?.length) urgent.forEach(a => { msg += `🚨 *URGENT: ${a.binLabel} is FULL!*\nReported by: ${a.reports.join(", ")}\n\n`; });
    msg += `👤 It's *${np}'s* turn to empty the bins\n⏭️ Up next: ${nu}\n\n📅 Collection day: *${schedule.day}*\n\n✅ Open the app and tap the bin once emptied.\n🔗 https://bin-rota.vercel.app`;
    return msg;
  }
  function buildReportFullMessage(binTypeId, reporterName) {
    const bin = BIN_TYPES.find(b => b.id === binTypeId);
    const responsible = currentPerson?.name || "?";
    let msg = `🚨 *Bin Alert!*\n\n`;
    msg += `The *${bin?.label}* is full and needs emptying.\n\n`;
    msg += `👤 It's *${responsible}'s* turn to empty it.\n`;
    msg += `📢 Reported by: ${reporterName}\n\n`;
    msg += `Please empty the bin as soon as possible! 🙏\n🔗 https://bin-rota.vercel.app`;
    return msg;
  }
  function copyText(text, setCopied) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }).catch(() => {});
  }

  // Actions
  function doMarkEmptied(person, binTypeIds, outOfTurn = false) {
    const turnId = Date.now();
    const newAlerts = alerts.filter(a => !binTypeIds.includes(a.binType));
    const entries = binTypeIds.map((binTypeId, i) => ({
      id: turnId + i, turnId,
      personId: person.id, personName: person.name,
      binType: binTypeId,
      date: new Date().toLocaleDateString("en-GB"), ts: turnId,
      ...(outOfTurn ? { outOfTurn: true } : {}),
    }));
    // Clear forced IDs (next becomes current when current empties)
    const newCurrent = !outOfTurn && forcedNextId !== null ? forcedNextId : null;
    saveState({
      history: [...entries, ...history].slice(0, 100),
      alerts: newAlerts,
      ...(outOfTurn ? {} : { forcedCurrentId: newCurrent, forcedNextId: null }),
    });
    if (justDoneTimer.current) clearTimeout(justDoneTimer.current);
    setJustDone({ binTypeIds, personName: person.name, upNextName: outOfTurn ? null : upNext?.name || null });
    setDoneCopied(false);
    justDoneTimer.current = setTimeout(() => setJustDone(null), 8000);
  }

  // Convert the most recent out-of-turn entry by this person into a real turn,
  // so they advance in the rota and get skipped next time (fair to them).
  function skipCovererTurn(coverer) {
    const newHistory = [...stateRef.current.history];
    // Find the most recent outOfTurn entry by this person and convert it
    let updated = false;
    for (let i = 0; i < newHistory.length; i++) {
      if (newHistory[i].personId === coverer.id && newHistory[i].outOfTurn && !updated) {
        newHistory[i] = { ...newHistory[i], outOfTurn: false };
        updated = true;
      }
    }
    if (updated) saveState({ history: newHistory });
  }

  // Tap green button → show bin picker for that bin (not both)
  function handleBinTap(binTypeId) {
    if (!currentPerson) return;
    setShowBinPicker(binTypeId);
  }
  function onBinPickerDone(binTypeIds) {
    setShowBinPicker(null);
    if (!binTypeIds.length) return;
    setShowWhoAreYou({ binTypeIds });
  }
  function onWhoAreYouDone(person, binTypeIds) {
    setShowWhoAreYou(null);
    if (!person) return;
    const outOfTurn = currentPerson && person.id !== currentPerson.id;
    if (outOfTurn) {
      doMarkEmptied(person, binTypeIds, true);
      setShowSkipConfirm({ skippedPerson: currentPerson, coveredBy: person });
    } else {
      doMarkEmptied(person, binTypeIds, false);
    }
  }

  function reportFull(binTypeId, reporterName) {
    const bin = BIN_TYPES.find(b => b.id === binTypeId);
    if (!bin) return;
    const existing = alerts.find(a => a.binType === binTypeId);
    const name = reporterName || "Someone";
    if (existing) {
      if (existing.reports?.includes(name)) return;
      saveState({ alerts: alerts.map(a => a.binType === binTypeId ? { ...a, reports: [...(a.reports||[]), name] } : a) });
    } else {
      saveState({ alerts: [...alerts, { id: Date.now(), binType: binTypeId, binLabel: bin.label, reports: [name], ts: Date.now() }] });
    }
  }
  function startEdit(r) { setEditingId(r.id); setEditingName(r.name); }
  function cancelEdit() { setEditingId(null); setEditingName(""); }
  function saveEdit(id) {
    const t = editingName.trim(); if (!t) return;
    saveState({ residents: residents.map(r => r.id === id ? { ...r, name: t } : r) });
    setEditingId(null); setEditingName("");
  }
  function toggleActive(id) {
    const person = residents.find(r => r.id === id);
    const isReturning = person && !person.active;
    const newResidents = residents.map(r => r.id === id ? { ...r, active: !r.active } : r);
    if (isReturning) {
      const updatedHistory = applyReturnFromAway(history, person, newResidents);
      saveState({ residents: newResidents, history: updatedHistory });
    } else {
      saveState({ residents: newResidents });
    }
  }
  function deleteResident(id) {
    if (editingId === id) cancelEdit();
    saveState({ residents: residents.filter(r => r.id !== id), history: history.filter(e => e.personId !== id) });
  }
  function addResident() {
    const t = addingName.trim(); if (!t) return;
    const newId = Math.max(0, ...residents.map(r => r.id)) + 1;
    saveState({ residents: [...residents, { id: newId, name: t, active: true }] });
    setAddingName(""); setShowAddForm(false);
  }

  const cardStyle    = { background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:"16px", overflow:"hidden" };
  const sectionLabel = { fontSize:"12px", fontWeight:"600", color:T.textFaint, letterSpacing:"0.3px", textTransform:"uppercase", marginBottom:"8px" };
  const statusDot    = connStatus==="live"?T.syncActive:connStatus==="error"?"#ff453a":"#f0a500";
  const statusText   = connStatus==="live"?"Live":connStatus==="error"?"Offline":"Connecting…";

  const bins = BIN_TYPES;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:FONT, transition:"background 0.25s, color 0.25s" }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:0;}
        .btn{cursor:pointer;border:none;font-family:${FONT};transition:opacity 0.12s,transform 0.1s;border-radius:10px;font-weight:500;}
        .btn:hover{opacity:0.78;}
        .btn:active{transform:scale(0.96);opacity:0.6;}
        .btn:disabled{opacity:0.35;cursor:not-allowed;transform:none;}
        input{outline:none;font-family:${FONT};}
        .fade-in{animation:fadeIn 0.25s ease;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        .alert-pulse{animation:alertPulse 2.5s infinite;}
        @keyframes alertPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,59,48,.25)}50%{box-shadow:0 0 0 7px rgba(255,59,48,0)}}
        .urgent-pulse{animation:urgentPulse 1.8s infinite;}
        @keyframes urgentPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,107,0,.3)}50%{box-shadow:0 0 0 9px rgba(255,107,0,0)}}
        .done-pop{animation:donePop 0.4s cubic-bezier(0.175,0.885,0.32,1.275);}
        @keyframes donePop{0%{transform:scale(0.9);opacity:0}60%{transform:scale(1.03)}100%{transform:scale(1);opacity:1}}
        @keyframes connPulse{0%,100%{opacity:1}50%{opacity:0.35}}
      `}</style>

      {/* PIN Modal */}
      {showPin && <PinModal onSuccess={onPinSuccess} onCancel={() => { setShowPin(false); setPendingAction(null); }} T={T} />}

      {/* WELCOME */}
      {showWelcome && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:120, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}>
          <div style={{ background:T.bgCard, borderRadius:"24px", padding:"28px 24px", width:"100%", maxWidth:"360px" }}>
            <div style={{ textAlign:"center", marginBottom:"20px" }}>
              <div style={{ fontSize:"52px", marginBottom:"8px" }}>🗑️</div>
              <div style={{ fontSize:"22px", fontWeight:"800", color:T.text }}>Bin Rota</div>
              <div style={{ fontSize:"14px", color:T.textFaint, marginTop:"4px" }}>Your shared house bin schedule</div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:"10px", marginBottom:"20px" }}>
              {[
                { icon:"👤", text:"See whose turn it is" },
                { icon:"✅", text:"Tap the green button when you empty a bin" },
                { icon:"🚨", text:"Report Full if a bin is overflowing" },
              ].map((item, i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:"12px", background:T.bgCard2, borderRadius:"12px", padding:"12px 14px" }}>
                  <div style={{ fontSize:"22px", flexShrink:0 }}>{item.icon}</div>
                  <div style={{ fontSize:"14px", color:T.text }}>{item.text}</div>
                </div>
              ))}
            </div>
            <button className="btn" onClick={() => {
              try { localStorage.setItem("binrota-visited", "1"); } catch(e) {}
              setShowWelcome(false);
            }} style={{ width:"100%", padding:"14px", fontSize:"15px", fontWeight:"700", background:T.currentAccent, color:"#fff", border:"none" }}>
              Got it — let me in ✓
            </button>
          </div>
        </div>
      )}

      {/* HELP MODAL */}
      {showHelp && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:110, display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={() => setShowHelp(false)}>
          <div style={{ background:T.bgCard, borderRadius:"24px 24px 0 0", padding:"24px 20px 40px", width:"100%", maxWidth:"480px", maxHeight:"85vh", overflowY:"auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"20px" }}>
              <div style={{ fontSize:"20px", fontWeight:"700", color:T.text }}>How to use Bin Rota</div>
              <button className="btn" onClick={() => setShowHelp(false)} style={{ background:T.bgCard2, border:`1px solid ${T.border}`, color:T.textMuted, padding:"6px 12px", fontSize:"15px" }}>✕</button>
            </div>
            {[
              { icon:"👤", title:"Whose turn is it?", body:"The big green card on the Rota tab shows whose turn it is to empty the bins." },
              { icon:"✅", title:"I just emptied a bin", body:"Tap the big green button for the bin you emptied. Pick your name. Done — the rota moves on." },
              { icon:"🗑️", title:"Both bins are full", body:"Tap either green button and choose 'Both bins' in the popup." },
              { icon:"🚨", title:"A bin is full but not your turn", body:"Tap Report Full. Pick your name. If 2 people report it, an urgent WhatsApp alert is generated." },
              { icon:"🙌", title:"Emptied but not your turn", body:"Pick your name. The app asks if it should count as YOUR turn (so the rota skips you next time and stays fair). The original person stays as current." },
              { icon:"💬", title:"Send WhatsApp reminder", body:"Tap the WhatsApp button to send the rota status to the group." },
            ].map((step, i) => (
              <div key={i} style={{ display:"flex", gap:"14px", marginBottom:"18px", alignItems:"flex-start" }}>
                <div style={{ fontSize:"26px", flexShrink:0, width:"36px", textAlign:"center" }}>{step.icon}</div>
                <div>
                  <div style={{ fontSize:"15px", fontWeight:"700", color:T.text, marginBottom:"3px" }}>{step.title}</div>
                  <div style={{ fontSize:"14px", color:T.textMuted, lineHeight:"1.55" }}>{step.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CONFIRM */}
      {showConfirm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:120, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }} onClick={() => setShowConfirm(null)}>
          <div style={{ background:T.bgCard, borderRadius:"20px", padding:"28px 24px", width:"100%", maxWidth:"340px" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:"36px", textAlign:"center", marginBottom:"10px" }}>{showConfirm.emoji}</div>
            <div style={{ fontSize:"18px", fontWeight:"700", textAlign:"center", color:T.text, marginBottom:"8px" }}>{showConfirm.title}</div>
            <div style={{ fontSize:"14px", color:T.textMuted, textAlign:"center", lineHeight:"1.6", marginBottom:"24px" }}>{showConfirm.body}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
              <button className="btn" onClick={() => { showConfirm.onConfirm(); setShowConfirm(null); }}
                style={{ padding:"14px", fontSize:"15px", fontWeight:"700", background:showConfirm.confirmColor||T.currentAccent, color:"#fff", border:"none" }}>
                {showConfirm.confirmLabel}
              </button>
              <button className="btn" onClick={() => setShowConfirm(null)}
                style={{ padding:"14px", fontSize:"15px", background:T.bgCard2, color:T.textMuted, border:`1px solid ${T.border}` }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* REPORT PICKER — pick your name */}
      {showReportPicker && (() => {
        const bin = BIN_TYPES.find(b => b.id === showReportPicker);
        const existing = alerts.find(a => a.binType === showReportPicker);
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}>
            <div style={{ background:T.bgCard, borderRadius:"20px", padding:"24px", width:"100%", maxWidth:"320px" }}>
              <div style={{ fontSize:"28px", textAlign:"center", marginBottom:"6px" }}>{bin?.emoji}</div>
              <div style={{ fontSize:"17px", fontWeight:"700", textAlign:"center", marginBottom:"4px", color:T.text }}>Who are you?</div>
              <div style={{ fontSize:"13px", color:T.textFaint, textAlign:"center", marginBottom:"16px" }}>Tap your name to report {bin?.label} as full</div>
              <div style={{ display:"flex", flexDirection:"column", gap:"8px", maxHeight:"260px", overflowY:"auto" }}>
                {residents.filter(r => r.active).map(r => {
                  const already = existing?.reports?.includes(r.name);
                  return (
                    <button key={r.id} className="btn" disabled={already} onClick={() => {
                      reportFull(showReportPicker, r.name);
                      const binId = showReportPicker;
                      setShowReportPicker(null);
                      setShowReportWA({ binTypeId: binId, reporterName: r.name });
                    }}
                      style={{ padding:"12px 16px", fontSize:"15px", fontWeight:"500", background:already?T.bgCard2:T.currentAccent, color:already?T.textFaint:"#fff", border:`1px solid ${already?T.border:T.currentAccent}`, textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      {r.name}{already && <span style={{ fontSize:"12px" }}>Reported ✓</span>}
                    </button>
                  );
                })}
              </div>
              <button className="btn" onClick={() => setShowReportPicker(null)} style={{ width:"100%", marginTop:"12px", background:T.bgCard2, color:T.textMuted, padding:"11px", fontSize:"14px", border:`1px solid ${T.border}` }}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* REPORT — WHATSAPP */}
      {showReportWA && (() => {
        const bin = BIN_TYPES.find(b => b.id === showReportWA.binTypeId);
        const msg = buildReportFullMessage(showReportWA.binTypeId, showReportWA.reporterName);
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={() => setShowReportWA(null)}>
            <div style={{ background:T.bgCard, borderRadius:"24px 24px 0 0", padding:"24px 20px 36px", width:"100%", maxWidth:"480px" }} onClick={e => e.stopPropagation()}>
              <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"16px" }}>
                <div style={{ fontSize:"28px" }}>{bin?.emoji}</div>
                <div>
                  <div style={{ fontSize:"17px", fontWeight:"700", color:T.alertText }}>🚨 {bin?.label} reported full!</div>
                  <div style={{ fontSize:"13px", color:T.textFaint, marginTop:"2px" }}>Send a WhatsApp alert to your group</div>
                </div>
              </div>
              <div style={{ background:isDark?"#0a1a0e":"#dcf8c6", borderRadius:"12px", padding:"14px 16px", fontSize:"13px", lineHeight:"1.65", color:isDark?"#d0f0d8":"#111", whiteSpace:"pre-wrap", marginBottom:"14px", border:`1px solid ${isDark?"#1a4a22":"#b5e7a0"}` }}>{msg}</div>
              <div style={{ display:"flex", gap:"8px", marginBottom:"10px" }}>
                <button className="btn" onClick={() => copyText(msg, setReportWACopied)} style={{ flex:1, background:reportWACopied?T.currentAccent:T.waGreen, color:"#fff", padding:"12px", fontSize:"14px", fontWeight:"700" }}>
                  {reportWACopied ? "✅ Copied!" : "📋 Copy"}
                </button>
                <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"
                  style={{ flex:1, background:T.waGreen, color:"#fff", padding:"12px", fontSize:"14px", fontWeight:"700", borderRadius:"10px", display:"flex", alignItems:"center", justifyContent:"center", textDecoration:"none" }}>
                  Send in WhatsApp ↗
                </a>
              </div>
              <button className="btn" onClick={() => setShowReportWA(null)} style={{ width:"100%", padding:"11px", fontSize:"14px", background:T.bgCard2, color:T.textMuted, border:`1px solid ${T.border}` }}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* BIN PICKER */}
      {showBinPicker && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}>
          <div style={{ background:T.bgCard, borderRadius:"20px", padding:"24px", width:"100%", maxWidth:"320px" }}>
            <div style={{ fontSize:"28px", textAlign:"center", marginBottom:"6px" }}>🗑️</div>
            <div style={{ fontSize:"17px", fontWeight:"700", textAlign:"center", marginBottom:"4px", color:T.text }}>Which bins did you empty?</div>
            <div style={{ fontSize:"12px", color:T.textFaint, textAlign:"center", marginBottom:"14px", lineHeight:1.5 }}>This counts as your turn in the rota</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
              <button className="btn" onClick={() => onBinPickerDone(["general","recycling"])} style={{ padding:"14px 16px", fontSize:"15px", fontWeight:"700", background:T.currentAccent, color:"#fff", border:"none", display:"flex", alignItems:"center", gap:"12px" }}>
                <span style={{ fontSize:"22px" }}>🗑️♻️</span><span>Both bins</span>
              </button>
              <button className="btn" onClick={() => onBinPickerDone([showBinPicker])} style={{ padding:"14px 16px", fontSize:"15px", fontWeight:"500", background:T.bgCard2, color:T.text, border:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:"12px" }}>
                <span style={{ fontSize:"22px" }}>{BIN_TYPES.find(b => b.id === showBinPicker)?.emoji}</span><span>{BIN_TYPES.find(b => b.id === showBinPicker)?.label} only</span>
              </button>
            </div>
            <button className="btn" onClick={() => setShowBinPicker(null)} style={{ width:"100%", marginTop:"12px", background:T.bgCard2, color:T.textMuted, padding:"11px", fontSize:"14px", border:`1px solid ${T.border}` }}>Cancel</button>
          </div>
        </div>
      )}

      {/* WHO ARE YOU */}
      {showWhoAreYou && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}>
          <div style={{ background:T.bgCard, borderRadius:"20px", padding:"24px", width:"100%", maxWidth:"320px" }}>
            <div style={{ fontSize:"28px", textAlign:"center", marginBottom:"6px" }}>👤</div>
            <div style={{ fontSize:"17px", fontWeight:"700", textAlign:"center", marginBottom:"4px", color:T.text }}>Who are you?</div>
            <div style={{ fontSize:"13px", color:T.textFaint, textAlign:"center", marginBottom:"16px" }}>
              {currentPerson ? `It's ${currentPerson.name}'s turn — are you them?` : "Select your name"}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:"8px", maxHeight:"260px", overflowY:"auto" }}>
              {residents.filter(r => r.active).map(r => {
                const isCurrent = r.id === currentPerson?.id;
                return (
                  <button key={r.id} className="btn" onClick={() => onWhoAreYouDone(r, showWhoAreYou.binTypeIds)}
                    style={{ padding:"12px 16px", fontSize:"15px", fontWeight:isCurrent?"700":"500", background:isCurrent?T.currentAccent:T.bgCard2, color:isCurrent?"#fff":T.text, border:`1.5px solid ${isCurrent?T.currentAccent:T.border}`, textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    {r.name}
                    {isCurrent && <span style={{ fontSize:"12px", opacity:0.85 }}>It's your turn ✓</span>}
                    {!isCurrent && <span style={{ fontSize:"12px", color:T.textFaint }}>Not your turn</span>}
                  </button>
                );
              })}
            </div>
            <button className="btn" onClick={() => setShowWhoAreYou(null)} style={{ width:"100%", marginTop:"12px", background:T.bgCard2, color:T.textMuted, padding:"11px", fontSize:"14px", border:`1px solid ${T.border}` }}>Cancel</button>
          </div>
        </div>
      )}

      {/* SKIP CONFIRM */}
      {showSkipConfirm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}>
          <div style={{ background:T.bgCard, borderRadius:"20px", padding:"28px 24px", width:"100%", maxWidth:"340px" }}>
            <div style={{ fontSize:"36px", textAlign:"center", marginBottom:"8px" }}>🙌</div>
            <div style={{ fontSize:"17px", fontWeight:"700", textAlign:"center", color:T.text, marginBottom:"10px" }}>
              Thanks for covering!
            </div>
            <div style={{ fontSize:"14px", color:T.textMuted, textAlign:"center", lineHeight:"1.6", marginBottom:"20px" }}>
              It was <span style={{ fontWeight:"600", color:T.text }}>{showSkipConfirm.skippedPerson.name}'s</span> turn but <span style={{ fontWeight:"600", color:T.text }}>{showSkipConfirm.coveredBy.name}</span> did it.
              <br/><br/>Should this count as <span style={{ fontWeight:"600", color:T.text }}>{showSkipConfirm.coveredBy.name}'s</span> turn so they get skipped next time?
              <br/><br/><span style={{ fontSize:"12px", color:T.textFaint }}>({showSkipConfirm.skippedPerson.name} stays as current either way)</span>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
              <button className="btn" onClick={() => { skipCovererTurn(showSkipConfirm.coveredBy); setShowSkipConfirm(null); }}
                style={{ padding:"14px", fontSize:"15px", fontWeight:"700", background:T.currentAccent, color:"#fff", border:"none" }}>
                ✅ Yes — count it as {showSkipConfirm.coveredBy.name}'s turn
              </button>
              <button className="btn" onClick={() => setShowSkipConfirm(null)}
                style={{ padding:"14px", fontSize:"15px", background:T.bgCard2, color:T.textMuted, border:`1px solid ${T.border}` }}>
                No — just a favour, no rota change
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={{ background:T.bgCard, borderBottom:`1px solid ${T.border}`, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:10 }}>
        <div>
          <div style={{ fontSize:"22px", fontWeight:"700", letterSpacing:"-0.5px" }}>Bin Rota</div>
          <div style={{ fontSize:"13px", color:T.textFaint, marginTop:"1px" }}>{activeResidents.length} active · {residents.length - activeResidents.length} away</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
          <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:statusDot, animation:connStatus==="connecting"?"connPulse 1.4s ease-in-out infinite":undefined }}/>
          <div style={{ fontSize:"11px", color:statusDot, fontWeight:"500", marginRight:"4px" }}>{statusText}</div>
          <button className="btn" onClick={() => setShowHelp(true)} style={{ background:T.bgCard2, border:`1px solid ${T.border}`, padding:"5px 10px", fontSize:"14px", fontWeight:"700", color:T.textMuted }}>?</button>
          <button className="btn" onClick={() => { if (isAdmin) setIsAdmin(false); else setShowPin(true); }} style={{ background:isAdmin?T.currentAccent:T.bgCard2, border:`1px solid ${isAdmin?T.currentAccent:T.border}`, padding:"5px 10px", fontSize:"15px" }}>{isAdmin?"🔓":"🔐"}</button>
          <button className="btn" onClick={toggleTheme} style={{ background:T.bgCard2, border:`1px solid ${T.border}`, borderRadius:"20px", padding:"3px", cursor:"pointer", height:"30px", width:"54px", position:"relative", flexShrink:0 }}>
            <span style={{ position:"absolute", left:"6px", top:"6px", fontSize:"12px", lineHeight:1, opacity:isDark?0.4:1 }}>☀️</span>
            <span style={{ position:"absolute", right:"6px", top:"6px", fontSize:"12px", lineHeight:1, opacity:isDark?1:0.4 }}>🌙</span>
            <div style={{ position:"absolute", top:"2px", left:isDark?"28px":"2px", width:"24px", height:"24px", borderRadius:"50%", background:isDark?"#3a3a3c":"#ffffff", boxShadow:"0 1px 3px rgba(0,0,0,0.2)", transition:"left 0.22s ease" }}/>
          </button>
        </div>
      </div>

      {/* OVERDUE WARNING */}
      {overdue && (
        <div style={{ margin:"12px 16px 0", background:T.overdueBg, border:`1.5px solid ${T.overdueBorder}`, borderRadius:"14px", padding:"12px 14px", display:"flex", alignItems:"center", gap:"10px" }}>
          <div style={{ fontSize:"22px" }}>⏰</div>
          <div style={{ fontSize:"13px", fontWeight:"600", color:T.overdueText }}>Bins haven't been emptied in a while</div>
        </div>
      )}

      {/* URGENT ALERTS */}
      {urgentAlerts.length > 0 && (
        <div style={{ padding:"12px 16px 0" }}>
          {urgentAlerts.map(alert => {
            const urgentMsg = buildWAMessage([alert]);
            return (
              <div key={alert.id} className="urgent-pulse fade-in" style={{ background:T.urgentBg, border:`2px solid ${T.urgentBorder}`, borderRadius:"16px", padding:"14px", marginBottom:"10px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
                  <div style={{ fontSize:"26px" }}>🚨</div>
                  <div>
                    <div style={{ fontSize:"15px", fontWeight:"800", color:T.urgentText }}>{alert.binLabel} — URGENT</div>
                    <div style={{ fontSize:"12px", color:T.textMuted }}>{alert.reports.join(" & ")} reported this full</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:"8px" }}>
                  <a href={`https://wa.me/?text=${encodeURIComponent(urgentMsg)}`} target="_blank" rel="noreferrer"
                    style={{ flex:1, background:T.waGreen, color:"#fff", padding:"10px", fontSize:"13px", fontWeight:"700", borderRadius:"10px", display:"flex", alignItems:"center", justifyContent:"center", textDecoration:"none" }}>Send in WhatsApp ↗</a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TABS */}
      <div style={{ display:"flex", padding:"12px 16px 0", gap:"6px" }}>
        {[["rota","🏠 Rota"],["residents","👥 Residents"],["history","📋 History"]].map(([id, lbl]) => (
          <button key={id} className="btn" onClick={() => setActiveTab(id)}
            style={{ flex:1, padding:"10px 8px", fontSize:"14px", fontWeight:activeTab===id?"700":"500", background:activeTab===id?T.bgCard:"transparent", color:activeTab===id?T.text:T.textFaint, border:activeTab===id?`1px solid ${T.border}`:"1px solid transparent", textAlign:"center" }}>{lbl}</button>
        ))}
      </div>

      <div style={{ padding:"16px" }}>

        {/* ════════ ROTA TAB ════════ */}
        {activeTab === "rota" && (
          <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

            {/* Admin forced-turn banner (invisible to flatmates) */}
            {(forcedCurrentId || forcedNextId) && isAdmin && (
              <div style={{ background:T.adminBg, border:`1px solid ${T.adminBorder}`, borderRadius:"12px", padding:"10px 14px" }}>
                <div style={{ fontSize:"13px", color:T.adminText, marginBottom:"6px" }}>🔐 Rota manually set by admin</div>
                <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
                  {forcedCurrentId && <div style={{ fontSize:"12px", color:T.adminText, border:`1px solid ${T.adminBorder}`, borderRadius:"8px", padding:"3px 10px" }}>★ Current: {residents.find(r=>r.id===forcedCurrentId)?.name}</div>}
                  {forcedNextId && <div style={{ fontSize:"12px", color:"#f59e0b", border:"1px solid #f59e0b", borderRadius:"8px", padding:"3px 10px" }}>⏭ Next: {residents.find(r=>r.id===forcedNextId)?.name}</div>}
                  <button className="btn" onClick={() => saveState({ forcedCurrentId:null, forcedNextId:null })} style={{ background:"transparent", color:T.adminText, fontSize:"12px", fontWeight:"600", padding:"3px 10px", border:`1px solid ${T.adminBorder}`, borderRadius:"8px", marginLeft:"auto" }}>Clear</button>
                </div>
              </div>
            )}

            {/* CURRENT TURN CARD — the main event */}
            {currentPerson ? (
              <div style={{ background:T.currentBg, border:`2px solid ${T.currentBorder}`, borderRadius:"24px", padding:"28px 24px", textAlign:"center" }}>
                <div style={{ fontSize:"13px", fontWeight:"700", color:T.currentAccent, textTransform:"uppercase", letterSpacing:"1px", marginBottom:"8px" }}>It's your turn</div>
                <div style={{ fontSize:"44px", fontWeight:"800", letterSpacing:"-1px", color:T.text, marginBottom:"8px" }}>{currentPerson.name}</div>
                {upNext && <div style={{ fontSize:"14px", color:T.textFaint }}>Up next: <span style={{ color:T.textMuted, fontWeight:"600" }}>{upNext.name}</span></div>}
              </div>
            ) : (
              <div style={{ ...cardStyle, padding:"24px", textAlign:"center", color:T.textFaint, fontSize:"15px" }}>No active residents.</div>
            )}

            {/* TWO BIG BUTTONS — the only actions */}
            <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
              {bins.map(bin => {
                const isDoneThis = justDone?.binTypeIds?.includes(bin.id);
                const alert = alerts.find(a => a.binType === bin.id);
                const isFull = !!alert;
                const isUrgent = isFull && alert.reports?.length >= REPORTS_TO_URGENT;

                if (isDoneThis) {
                  const binLabels = justDone.binTypeIds.map(id => BIN_TYPES.find(b => b.id === id)?.label).join(" & ");
                  const doneMsg = buildDoneMessage(justDone.personName, binLabels, justDone.upNextName);
                  return (
                    <div key={bin.id} className="done-pop fade-in" style={{ background:T.currentAccentBg, border:`2px solid ${T.currentAccent}`, borderRadius:"18px", padding:"18px 20px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"14px" }}>
                        <div style={{ fontSize:"44px" }}>✅</div>
                        <div>
                          <div style={{ fontSize:"18px", fontWeight:"700", color:T.currentAccent }}>Done! Thanks 🙌</div>
                          <div style={{ fontSize:"14px", color:T.textMuted, marginTop:"2px" }}>{binLabels} emptied</div>
                        </div>
                      </div>
                      <div style={{ background:isDark?"#0a1a0e":"#dcf8c6", borderRadius:"10px", padding:"10px 12px", fontSize:"13px", color:isDark?"#d0f0d8":"#111", whiteSpace:"pre-wrap", lineHeight:"1.5", marginBottom:"10px" }}>{doneMsg}</div>
                      <div style={{ display:"flex", gap:"8px" }}>
                        <button className="btn" onClick={() => copyText(doneMsg, setDoneCopied)} style={{ flex:1, background:doneCopied?T.currentAccent:T.waGreen, color:"#fff", padding:"10px", fontSize:"13px", fontWeight:"700" }}>{doneCopied?"✅ Copied!":"📋 Copy"}</button>
                        <a href={`https://wa.me/?text=${encodeURIComponent(doneMsg)}`} target="_blank" rel="noreferrer" style={{ flex:1, background:T.waGreen, color:"#fff", padding:"10px", fontSize:"13px", fontWeight:"700", borderRadius:"10px", display:"flex", alignItems:"center", justifyContent:"center", textDecoration:"none" }}>Send ↗</a>
                      </div>
                    </div>
                  );
                }

                return (
                  <button key={bin.id} className="btn" onClick={() => handleBinTap(bin.id)} disabled={!currentPerson}
                    style={{ width:"100%", borderRadius:"20px", border:"none",
                      background: isUrgent ? "linear-gradient(135deg,#ff6b00,#e65100)"
                        : isFull ? "linear-gradient(135deg,#ff3b30,#c0392b)"
                        : isDark ? "linear-gradient(135deg,#30d158,#28a745)"
                        : "linear-gradient(135deg,#34c759,#2dbe55)",
                      display:"flex", alignItems:"center", overflow:"hidden",
                      boxShadow: isFull ? "0 6px 24px rgba(255,59,48,0.4)" : "0 6px 24px rgba(52,199,89,0.35)" }}>
                    <div style={{ width:"84px", height:"84px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"38px", background:"rgba(0,0,0,0.12)", flexShrink:0 }}>{bin.emoji}</div>
                    <div style={{ flex:1, textAlign:"left", paddingLeft:"18px", paddingRight:"14px" }}>
                      <div style={{ fontSize:"11px", fontWeight:"700", color:"rgba(255,255,255,0.8)", textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:"3px" }}>
                        {isUrgent ? "🚨 URGENT — Tap to confirm" : isFull ? "⚠️ Reported full — Tap to confirm" : "I emptied"}
                      </div>
                      <div style={{ fontSize:"22px", fontWeight:"800", color:"#fff" }}>{bin.label}</div>
                    </div>
                    <div style={{ width:"52px", height:"84px", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.1)", flexShrink:0, fontSize:"26px", color:"rgba(255,255,255,0.85)" }}>✓</div>
                  </button>
                );
              })}
            </div>

            {/* REPORT FULL — small link, not a whole section */}
            <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
              <div style={{ fontSize:"12px", color:T.textFaint, textAlign:"center", fontWeight:"500", textTransform:"uppercase", letterSpacing:"0.5px" }}>Is a bin full?</div>
              <div style={{ display:"flex", gap:"8px" }}>
                {bins.map(bin => {
                  const alert = alerts.find(a => a.binType === bin.id);
                  const isFull = !!alert;
                  const reportCount = alert?.reports?.length || 0;
                  return (
                    <button key={bin.id} className="btn" onClick={() => {
                      if (isFull) return; // already reported
                      setShowConfirm({
                        emoji: bin.emoji,
                        title: `Report ${bin.label} as full?`,
                        body: "This will alert everyone. Only confirm if it genuinely needs emptying.",
                        confirmLabel: "Yes, report it",
                        confirmColor: T.alertText,
                        onConfirm: () => setShowReportPicker(bin.id),
                      });
                    }} style={{ flex:1, padding:"12px", fontSize:"13px", fontWeight:"600", background:isFull?T.alertBg:T.bgCard, color:isFull?T.alertText:T.text, border:`1.5px solid ${isFull?T.alertBorder:T.border}`, display:"flex", alignItems:"center", justifyContent:"center", gap:"6px" }}>
                      <span style={{ fontSize:"16px" }}>{bin.emoji}</span>
                      <span>{isFull ? `${reportCount} reported` : `Report ${bin.label}`}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* WHATSAPP BUTTON */}
            <div style={{ background:T.waBg, border:`1.5px solid ${T.waBorder}`, borderRadius:"16px", padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                  <span style={{ fontSize:"22px" }}>💬</span>
                  <div>
                    <div style={{ fontSize:"14px", fontWeight:"700", color:T.text }}>Send to WhatsApp</div>
                    <div style={{ fontSize:"12px", color:T.textFaint }}>Share the rota with your group</div>
                  </div>
                </div>
                <button className="btn" onClick={() => setShowWA(v => !v)} style={{ background:T.waGreen, color:"#fff", padding:"8px 14px", fontSize:"13px", fontWeight:"700" }}>{showWA ? "Close" : "Open"}</button>
              </div>
              {showWA && (
                <div className="fade-in" style={{ marginTop:"12px" }}>
                  <div style={{ background:isDark?"#0a1a0e":"#dcf8c6", borderRadius:"10px", padding:"12px", fontSize:"13px", lineHeight:"1.6", color:isDark?"#d0f0d8":"#111", whiteSpace:"pre-wrap", marginBottom:"10px", border:`1px solid ${isDark?"#1a4a22":"#b5e7a0"}` }}>{buildWAMessage()}</div>
                  <div style={{ display:"flex", gap:"8px" }}>
                    <button className="btn" onClick={() => copyText(buildWAMessage(), setWaCopied)} style={{ flex:1, background:waCopied?T.currentAccent:T.waGreen, color:"#fff", padding:"10px", fontSize:"13px", fontWeight:"700" }}>{waCopied?"✅ Copied!":"📋 Copy"}</button>
                    <a href={`https://wa.me/?text=${encodeURIComponent(buildWAMessage())}`} target="_blank" rel="noreferrer" style={{ flex:1, background:T.waGreen, color:"#fff", padding:"10px", fontSize:"13px", fontWeight:"700", borderRadius:"10px", display:"flex", alignItems:"center", justifyContent:"center", textDecoration:"none" }}>Send ↗</a>
                  </div>
                </div>
              )}
            </div>

            {/* ADMIN: collection day setter (hidden for flatmates) */}
            {isAdmin && (
              <div>
                <div style={sectionLabel}>🔐 Collection Day (admin)</div>
                <div style={{ ...cardStyle, padding:"14px" }}>
                  <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
                    {DAYS.map(d => <button key={d} className="btn" onClick={() => saveState({ schedule:{ ...schedule, day:d } })} style={{ padding:"7px 11px", fontSize:"13px", fontWeight:schedule.day===d?"700":"500", background:schedule.day===d?T.text:T.bgCard2, color:schedule.day===d?T.bg:T.textMuted, border:`1px solid ${schedule.day===d?T.text:T.border}` }}>{d}</button>)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════ RESIDENTS TAB ════════ */}
        {activeTab === "residents" && (
          <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

            {/* COMPETITIVE LEADERBOARD — visible to everyone */}
            {(() => {
              const sorted = [...residents].sort((a,b) => getTurnCount(history,b.id) - getTurnCount(history,a.id));
              const maxTurns = getTurnCount(history, sorted[0]?.id) || 1;
              const totalTurns = sorted.reduce((s,r) => s + getTurnCount(history,r.id), 0);
              const activePpl = sorted.filter(r=>r.active).length;
              const fairShare = activePpl > 0 ? totalTurns / activePpl : 0;
              const medals = ["🥇","🥈","🥉"];
              // Bar colours: top (most turns) = red-orange, bottom (fewest) = green
              const barColors = ["#ff3b30","#ff6b35","#ff9f0a","#f59e0b","#34c759","#30d158"];
              return (
                <div>
                  <div style={sectionLabel}>🏆 Who's Done the Most?</div>
                  <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:"20px", overflow:"hidden" }}>
                    {/* Header summary */}
                    <div style={{ padding:"14px 18px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:"13px", color:T.textFaint }}>Total empties: <span style={{ fontWeight:"700", color:T.text }}>{totalTurns}</span></div>
                      <div style={{ fontSize:"13px", color:T.textFaint }}>Fair share: <span style={{ fontWeight:"700", color:T.text }}>{Math.round(fairShare)}</span> each</div>
                    </div>
                    {sorted.map((r, idx) => {
                      const turns = getTurnCount(history, r.id);
                      const barPct = maxTurns > 0 ? Math.max(4, Math.round((turns/maxTurns)*100)) : 4;
                      const diff = turns - Math.round(fairShare);
                      const isOver = diff > 0, isUnder = diff < 0;
                      const barColor = barColors[Math.min(idx, barColors.length-1)];
                      const isCurrent = r.id === currentPerson?.id;
                      const lastEntry = history.filter(h=>h.personId===r.id&&!h.outOfTurn&&!h.awayCredit&&!h.skipped)[0];
                      return (
                        <div key={r.id} style={{ padding:"14px 18px", borderBottom:idx<sorted.length-1?`1px solid ${T.border}`:"none", background:isCurrent?T.currentBg:"transparent" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"8px" }}>
                            {/* Rank badge */}
                            <div style={{ width:"28px", textAlign:"center", flexShrink:0, fontSize:idx<3?"20px":"14px", fontWeight:"700", color:T.textFaint }}>
                              {idx<3 ? medals[idx] : `#${idx+1}`}
                            </div>
                            {/* Avatar */}
                            <div style={{ width:"36px", height:"36px", borderRadius:"50%", flexShrink:0, background:barColor+"22", border:`2px solid ${barColor}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"15px", fontWeight:"800", color:barColor }}>
                              {r.name.charAt(0).toUpperCase()}
                            </div>
                            {/* Name + status */}
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:"6px", flexWrap:"wrap" }}>
                                <span style={{ fontSize:"15px", fontWeight:"700", color:T.text }}>{r.name}</span>
                                {isCurrent && <span style={{ fontSize:"10px", background:T.currentAccentBg, color:T.currentAccent, padding:"2px 7px", borderRadius:"20px", fontWeight:"700" }}>Current</span>}
                                {!r.active && <span style={{ fontSize:"10px", background:T.pillBg, color:T.textFaint, padding:"2px 7px", borderRadius:"20px" }}>✈️ Away</span>}
                              </div>
                              <div style={{ fontSize:"11px", color:T.textFaint, marginTop:"1px" }}>Last: {lastEntry?.date||"Never"}</div>
                            </div>
                            {/* Turn count + badge */}
                            <div style={{ textAlign:"right", flexShrink:0 }}>
                              <div style={{ fontSize:"22px", fontWeight:"900", color:barColor, lineHeight:1 }}>{turns}</div>
                              <div style={{ fontSize:"10px", fontWeight:"600", marginTop:"2px", color:isOver?"#ff3b30":isUnder?T.currentAccent:"#f59e0b" }}>
                                {isOver ? `+${diff} over` : isUnder ? `${diff} under` : "on track"}
                              </div>
                            </div>
                          </div>
                          {/* Horizontal bar */}
                          <div style={{ marginLeft:"38px", height:"10px", background:T.bgCard2, borderRadius:"5px", overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${barPct}%`, background:`linear-gradient(90deg,${barColor}cc,${barColor})`, borderRadius:"5px", transition:"width 0.6s cubic-bezier(0.34,1.56,0.64,1)" }}/>
                          </div>
                        </div>
                      );
                    })}
                    {/* Legend */}
                    <div style={{ padding:"10px 18px", borderTop:`1px solid ${T.border}`, display:"flex", gap:"16px", justifyContent:"center" }}>
                      <div style={{ fontSize:"11px", color:T.textFaint, display:"flex", alignItems:"center", gap:"4px" }}><span style={{ width:"10px", height:"10px", borderRadius:"50%", background:"#ff3b30", display:"inline-block" }}/> Most</div>
                      <div style={{ fontSize:"11px", color:T.textFaint, display:"flex", alignItems:"center", gap:"4px" }}><span style={{ width:"10px", height:"10px", borderRadius:"50%", background:"#34c759", display:"inline-block" }}/> Fewest</div>
                      <div style={{ fontSize:"11px", color:T.textFaint, display:"flex", alignItems:"center", gap:"4px" }}><span style={{ width:"10px", height:"10px", borderRadius:"50%", background:"#f59e0b", display:"inline-block" }}/> On track</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── ADMIN SECTION (hidden from flatmates) ── */}
            {isAdmin && (
              <>
                <div style={sectionLabel}>🔐 Admin Tools</div>

                <div style={{ display:"flex", gap:"8px" }}>
                  <button className="btn" onClick={() => setShowFairnessStats(v => !v)} style={{ flex:1, padding:"11px", fontSize:"13px", fontWeight:"600", background:showFairnessStats?T.currentAccent:T.bgCard, color:showFairnessStats?"#fff":T.text, border:`1px solid ${showFairnessStats?T.currentAccent:T.border}` }}>
                    📊 {showFairnessStats?"Hide Stats":"Fairness Stats"}
                  </button>
                  <button className="btn" onClick={() => setShowConfirm({
                    emoji:"🔁", title:"Reset the whole rota?", body:"Clears all turns and history. Cannot be undone.",
                    confirmLabel:"Yes, reset everything", confirmColor:T.removeBtnText,
                    onConfirm: () => saveState({ history:[], alerts:[], forcedCurrentId:null, forcedNextId:null }),
                  })} style={{ flex:1, padding:"11px", fontSize:"13px", fontWeight:"600", background:T.bgCard, color:T.removeBtnText, border:`1.5px solid ${T.alertBorder}` }}>
                    🔁 Reset Rota
                  </button>
                </div>

                {/* FAIRNESS STATS */}
                {showFairnessStats && (() => {
                  const sorted = [...residents].sort((a, b) => getTurnCount(history, b.id) - getTurnCount(history, a.id));
                  const maxTurns = getTurnCount(history, sorted[0]?.id) || 1;
                  const totalTurns = sorted.reduce((s, r) => s + getTurnCount(history, r.id), 0);
                  const fairShare = totalTurns > 0 ? (totalTurns / sorted.filter(r => r.active).length) : 0;
                  const medals = ["🥇","🥈","🥉"];
                  return (
                    <div className="fade-in" style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:"16px", overflow:"hidden" }}>
                      <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <div style={{ fontSize:"14px", fontWeight:"700", color:T.text }}>🏆 Turn Leaderboard</div>
                        <div style={{ fontSize:"12px", color:T.textFaint }}>Fair share: {Math.round(fairShare)} each</div>
                      </div>
                      {sorted.map((r, idx) => {
                        const turns = getTurnCount(history, r.id);
                        const barPct = Math.round((turns / maxTurns) * 100);
                        const lastEntry = history.filter(h => h.personId === r.id && !h.outOfTurn && !h.awayCredit && !h.skipped)[0];
                        const diff = turns - Math.round(fairShare);
                        const isOver = diff > 0, isUnder = diff < 0;
                        const barColor = isOver ? "#ff3b30" : isUnder ? T.currentAccent : "#f59e0b";
                        return (
                          <div key={r.id} style={{ padding:"13px 16px", borderBottom:idx<sorted.length-1?`1px solid ${T.border}`:"none" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"8px" }}>
                              <div style={{ fontSize:"18px", width:"24px", textAlign:"center", flexShrink:0 }}>
                                {idx<3 ? medals[idx] : <span style={{ fontSize:"13px", color:T.textFaint, fontWeight:"600" }}>#{idx+1}</span>}
                              </div>
                              <div style={{ width:"30px", height:"30px", borderRadius:"50%", background:T.bgCard2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"13px", fontWeight:"700", color:T.textFaint, flexShrink:0 }}>
                                {r.name.charAt(0).toUpperCase()}
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:"14px", fontWeight:"600", color:T.text }}>{r.name}{!r.active&&<span style={{ fontSize:"10px", color:T.textFaint, marginLeft:"6px" }}>✈️</span>}</div>
                                <div style={{ fontSize:"11px", color:T.textFaint }}>Last: {lastEntry?.date||"Never"}</div>
                              </div>
                              <div style={{ textAlign:"right", flexShrink:0 }}>
                                <div style={{ fontSize:"16px", fontWeight:"800", color:T.text }}>{turns}</div>
                                <div style={{ fontSize:"10px", fontWeight:"600", color:isOver?"#ff3b30":isUnder?T.currentAccent:"#f59e0b" }}>
                                  {isOver?`+${diff} over`:isUnder?`${diff} under`:"on track"}
                                </div>
                              </div>
                            </div>
                            <div style={{ height:"6px", background:T.bgCard2, borderRadius:"3px", overflow:"hidden", marginLeft:"34px" }}>
                              <div style={{ height:"100%", width:`${barPct}%`, background:barColor, borderRadius:"3px", transition:"width 0.5s ease" }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* ADD PERSON */}
                <button className="btn" onClick={() => { setShowAddForm(v => !v); setAddingName(""); }} style={{ width:"100%", padding:"12px", fontSize:"14px", fontWeight:"600", background:showAddForm?T.bgCard2:T.currentAccent, color:showAddForm?T.textMuted:"#fff", border:`1px solid ${showAddForm?T.border:T.currentAccent}` }}>
                  {showAddForm ? "Cancel" : "+ Add Person"}
                </button>

                {showAddForm && (
                  <div className="fade-in" style={{ display:"flex", gap:"8px" }}>
                    <input type="text" value={addingName} onChange={e => setAddingName(e.target.value)}
                      onKeyDown={e => { if(e.key==="Enter") addResident(); if(e.key==="Escape") { setShowAddForm(false); setAddingName(""); } }}
                      placeholder="Enter name…" autoFocus
                      style={{ flex:1, background:T.bgInput, border:`1px solid ${T.border}`, borderRadius:"10px", padding:"10px 14px", color:T.text, fontSize:"15px" }} />
                    <button className="btn" onClick={addResident} style={{ background:T.currentAccent, color:"#fff", padding:"10px 20px", fontSize:"15px", fontWeight:"600" }}>Add</button>
                  </div>
                )}
              </>
            )}

            {/* RESIDENTS LIST — admin only (flatmates see the leaderboard above) */}
            {isAdmin && <div style={cardStyle}>
              {residents.length === 0 && <div style={{ padding:"28px", textAlign:"center", color:T.textFaint, fontSize:"14px" }}>No residents yet.</div>}
              {residents.map((r, idx) => {
                const isCurrent = r.id === currentPerson?.id;
                return (
                  <div key={r.id} style={{ padding:"14px 16px", borderBottom:idx<residents.length-1?`1px solid ${T.border}`:"none", display:"flex", alignItems:"center", gap:"12px", opacity:r.active?1:0.45 }}>
                    <div style={{ width:"38px", height:"38px", borderRadius:"50%", flexShrink:0, background:isCurrent&&r.active?T.currentAccentBg:T.bgCard2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"16px", fontWeight:"700", color:isCurrent&&r.active?T.currentAccent:T.textFaint }}>
                      {r.name.charAt(0).toUpperCase()}
                    </div>
                    {editingId === r.id ? (
                      <input type="text" value={editingName} onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => { if(e.key==="Enter") saveEdit(r.id); if(e.key==="Escape") cancelEdit(); }} autoFocus
                        style={{ flex:1, background:T.bgInput, border:`1px solid ${T.border}`, borderRadius:"8px", padding:"6px 10px", color:T.text, fontSize:"15px" }} />
                    ) : (
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"6px", flexWrap:"wrap" }}>
                          <span style={{ fontSize:"15px", fontWeight:"500" }}>{r.name}</span>
                          {isCurrent && r.active && <span style={{ fontSize:"11px", background:T.currentAccentBg, color:T.currentAccent, padding:"1px 7px", borderRadius:"20px", fontWeight:"600" }}>Current</span>}
                          {!r.active && <span style={{ fontSize:"11px", background:T.pillBg, color:T.textFaint, padding:"1px 7px", borderRadius:"20px", fontWeight:"500" }}>✈️ Away</span>}
                        </div>
                      </div>
                    )}
                    {/* Admin-only actions */}
                    {isAdmin && editingId === r.id ? (
                      <div style={{ display:"flex", gap:"6px" }}>
                        <button className="btn" onClick={() => saveEdit(r.id)} style={{ background:T.currentAccent, color:"#fff", padding:"6px 14px", fontSize:"13px", fontWeight:"600" }}>Save</button>
                        <button className="btn" onClick={cancelEdit} style={{ background:T.bgCard2, color:T.textMuted, padding:"6px 10px", fontSize:"16px", border:`1px solid ${T.border}` }}>✕</button>
                      </div>
                    ) : isAdmin ? (
                      <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                        <Toggle checked={r.active} onChange={() => toggleActive(r.id)} color={T.toggleColor}/>
                        <button className="btn" onClick={() => startEdit(r)} style={{ background:"transparent", color:T.textFaint, padding:"4px", fontSize:"17px" }}>✏️</button>
                        <button className="btn" onClick={() => deleteResident(r.id)} style={{ background:"transparent", color:T.removeBtnText, padding:"4px", fontSize:"17px", opacity:0.6 }}>🗑️</button>
                        <button className="btn" onClick={() => saveState({ forcedCurrentId: forcedCurrentId===r.id?null:r.id })} style={{ background:forcedCurrentId===r.id?T.currentAccent:"transparent", color:forcedCurrentId===r.id?"#fff":T.currentAccent, padding:"4px 7px", fontSize:"12px", fontWeight:"700", border:`1px solid ${T.currentAccent}`, borderRadius:"8px" }}>
                          {forcedCurrentId===r.id ? "★ Now" : "☆"}
                        </button>
                        <button className="btn" onClick={() => saveState({ forcedNextId: forcedNextId===r.id?null:r.id })} style={{ background:forcedNextId===r.id?"#f59e0b":"transparent", color:forcedNextId===r.id?"#fff":"#f59e0b", padding:"4px 7px", fontSize:"12px", fontWeight:"700", border:"1px solid #f59e0b", borderRadius:"8px" }}>
                          {forcedNextId===r.id ? "⏭ Next" : "⏭"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>}
          </div>
        )}

        {/* ════════ HISTORY TAB ════════ */}
        {activeTab === "history" && (
          <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            {isAdmin && history.length > 0 && (
              <button className="btn" onClick={() => setShowConfirm({
                emoji:"🗑️", title:"Clear all history?", body:"Permanently deletes the log. Cannot be undone.",
                confirmLabel:"Yes, clear history", confirmColor:T.removeBtnText,
                onConfirm: () => saveState({ history:[] }),
              })} style={{ width:"100%", padding:"12px", fontSize:"13px", fontWeight:"600", background:T.bgCard, color:T.removeBtnText, border:`1.5px solid ${T.alertBorder}` }}>
                🗑️ Clear All History (admin)
              </button>
            )}
            <div>
              <div style={sectionLabel}>Emptying Log</div>
              {history.length === 0 ? (
                <div style={{ textAlign:"center", padding:"60px 20px", color:T.textVeryFaint, fontSize:"15px", lineHeight:1.6 }}>No history yet.<br/>Tap a bin button to start the log.</div>
              ) : (
                <div style={cardStyle}>
                  {history.map((h, idx) => {
                    const bin = BIN_TYPES.find(b => b.id === h.binType);
                    return (
                      <div key={h.id} style={{ padding:"13px 16px", borderBottom:idx<history.length-1?`1px solid ${T.border}`:"none", display:"flex", alignItems:"center", gap:"12px" }}>
                        <div style={{ fontSize:"22px" }}>{h.skipped?"⏭️":h.awayCredit?"✈️":h.outOfTurn?"🙌":bin?.emoji||"🗑️"}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:"15px" }}>
                            <span style={{ fontWeight:"600" }}>{h.personName}</span>
                            <span style={{ color:T.textMuted }}>
                              {h.skipped ? " — turn skipped"
                                : h.awayCredit ? " — was away (catch-up)"
                                : h.outOfTurn ? " covered (not their turn)"
                                : ` emptied ${bin?.label||h.binType}`}
                            </span>
                          </div>
                          <div style={{ fontSize:"12px", color:T.textFaint, marginTop:"2px" }}>{h.date}</div>
                        </div>
                        {isAdmin ? (
                          <button className="btn" onClick={() => saveState({ history: history.filter(e => e.id !== h.id) })}
                            style={{ background:"transparent", color:T.removeBtnText, padding:"4px 8px", fontSize:"15px", opacity:0.6, flexShrink:0 }}>✕</button>
                        ) : (
                          <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:T.currentAccent, opacity:0.5, flexShrink:0 }}/>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ textAlign:"center", padding:"24px 20px 32px", borderTop:`1px solid ${T.footerBorder}`, marginTop:"8px" }}>
        <div style={{ fontSize:"12px", color:T.footerText, marginBottom:"6px" }}>Real-time sync · data stored securely in Firebase · <span style={{ fontWeight:"600" }}>v4.3</span></div>
        <div style={{ fontSize:"13px", color:T.textFaint }}>Made with ♥ by <span style={{ color:T.currentAccent, fontWeight:"600" }}>Yassine</span></div>
      </div>
    </div>
  );
}
