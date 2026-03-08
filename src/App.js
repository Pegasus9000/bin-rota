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

const DB_PATH = "binrota/state";

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
  history:  [],
  alerts:   [],
  schedule: { day: "Mon", frequencyDays: 7 },
};

const BIN_TYPES = [
  { id: "general",   label: "General Waste", emoji: "🗑️" },
  { id: "recycling", label: "Recycling",      emoji: "♻️" },
];

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

let _db = null;
function getDB() {
  if (!_db) {
    const app = initializeApp(FIREBASE_CONFIG);
    _db = getDatabase(app);
  }
  return _db;
}

function getNextPersonIndex(history, residents) {
  const active = residents.filter((r) => r.active);
  if (!active.length) return -1;
  const counts = active.map((r) => ({
    id: r.id,
    count: history.filter((h) => h.personId === r.id).length,
  }));
  counts.sort((a, b) => a.count - b.count);
  return residents.findIndex((r) => r.id === counts[0].id);
}

function usePrefersDark() {
  const [dark, setDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = (e) => setDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return dark;
}

function Toggle({ checked, onChange, color }) {
  return (
    <div onClick={onChange} style={{ width:"44px", height:"26px", borderRadius:"13px", background: checked ? color : "#ccc", position:"relative", cursor:"pointer", transition:"background 0.2s", flexShrink:0 }}>
      <div style={{ position:"absolute", top:"3px", left: checked ? "21px" : "3px", width:"20px", height:"20px", borderRadius:"50%", background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,0.3)", transition:"left 0.2s" }} />
    </div>
  );
}

export default function BinRota() {
  const isDark = usePrefersDark();

  const T = isDark ? {
    bg:"#1c1c1e", bgCard:"#2c2c2e", bgCard2:"#3a3a3c", bgInput:"#1c1c1e",
    border:"#3a3a3c", text:"#ffffff", textMuted:"#aeaeb2", textFaint:"#636366", textVeryFaint:"#3a3a3c",
    currentBg:"#0d2818", currentBorder:"#1a5c35", currentAccent:"#30d158", currentAccentBg:"#0d3320", currentAccentBg2:"#0a2015",
    alertBg:"#2d0f0f", alertBorder:"#5c1a1a", alertText:"#ff453a", alertSubtext:"#bf4040",
    removeBtnText:"#ff453a", footerBorder:"#2c2c2e", footerText:"#48484a",
    syncActive:"#30d158", syncIdle:"#48484a", toggleColor:"#30d158", pillBg:"#3a3a3c",
    waGreen:"#25d366", waBg:"#0d2d1a", waBorder:"#1a5c35",
  } : {
    bg:"#f2f2f7", bgCard:"#ffffff", bgCard2:"#f2f2f7", bgInput:"#ffffff",
    border:"#e5e5ea", text:"#000000", textMuted:"#6e6e73", textFaint:"#aeaeb2", textVeryFaint:"#d1d1d6",
    currentBg:"#f0fff4", currentBorder:"#34c759", currentAccent:"#34c759", currentAccentBg:"#d1f7dc", currentAccentBg2:"#e8fdf0",
    alertBg:"#fff2f2", alertBorder:"#ff3b30", alertText:"#ff3b30", alertSubtext:"#cc2f26",
    removeBtnText:"#ff3b30", footerBorder:"#e5e5ea", footerText:"#c7c7cc",
    syncActive:"#34c759", syncIdle:"#d1d1d6", toggleColor:"#34c759", pillBg:"#e5e5ea",
    waGreen:"#25d366", waBg:"#f0fff8", waBorder:"#34c759",
  };

  const [residents, setResidents] = useState(DEFAULT_STATE.residents);
  const [history,   setHistory]   = useState(DEFAULT_STATE.history);
  const [alerts,    setAlerts]    = useState(DEFAULT_STATE.alerts);
  const [schedule,  setSchedule]  = useState(DEFAULT_STATE.schedule);
  const [editingId,    setEditingId]    = useState(null);
  const [editingName,  setEditingName]  = useState("");
  const [addingName,   setAddingName]   = useState("");
  const [showAddForm,  setShowAddForm]  = useState(false);
  const [activeTab,    setActiveTab]    = useState("rota");
  const [connStatus,   setConnStatus]   = useState("connecting");
  const [justDone,     setJustDone]     = useState(null);
  const [showWA,       setShowWA]       = useState(false);
  const [waCopied,     setWaCopied]     = useState(false);

  const stateRef         = useRef({ residents, history, alerts, schedule });
  stateRef.current       = { residents, history, alerts, schedule };
  const skipNextSnapshot = useRef(false);
  const justDoneTimer    = useRef(null);

  useEffect(() => {
    let db;
    try { db = getDB(); } catch (e) { setConnStatus("error"); return; }
    const dbRef = ref(db, DB_PATH);
    const unsubscribe = onValue(
      dbRef,
      (snapshot) => {
        if (skipNextSnapshot.current) { skipNextSnapshot.current = false; return; }
        const data = snapshot.val();
        if (data) {
          if (Array.isArray(data.residents) && data.residents.length > 0) setResidents(data.residents);
          if (Array.isArray(data.history))  setHistory(data.history);
          if (Array.isArray(data.alerts))   setAlerts(data.alerts);
          if (data.schedule && typeof data.schedule === "object") setSchedule(data.schedule);
        }
        setConnStatus("live");
      },
      (error) => { console.error("Firebase error:", error); setConnStatus("error"); }
    );
    return () => off(dbRef, "value", unsubscribe);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { if (justDoneTimer.current) clearTimeout(justDoneTimer.current); };
  }, []);

  function saveState(patch) {
    const next = { ...stateRef.current, ...patch };
    skipNextSnapshot.current = true;
    try { set(ref(getDB(), DB_PATH), next); } catch (e) { skipNextSnapshot.current = false; }
    if (patch.residents !== undefined) setResidents(patch.residents);
    if (patch.history   !== undefined) setHistory(patch.history);
    if (patch.alerts    !== undefined) setAlerts(patch.alerts);
    if (patch.schedule  !== undefined) setSchedule(patch.schedule);
  }

  const currentPersonIdx = getNextPersonIndex(history, residents);
  const currentPerson    = currentPersonIdx >= 0 ? residents[currentPersonIdx] : null;
  const activeResidents  = residents.filter((r) => r.active);
  const currentActiveIdx = currentPerson ? activeResidents.findIndex((r) => r.id === currentPerson.id) : -1;
  const upNext           = activeResidents.length > 1 ? activeResidents[(currentActiveIdx + 1) % activeResidents.length] : null;

  function markEmptied(binTypeId) {
    if (!currentPerson) return;
    const entry = { id: Date.now(), personId: currentPerson.id, personName: currentPerson.name, binType: binTypeId, date: new Date().toLocaleDateString("en-GB"), ts: Date.now() };
    saveState({ history: [entry, ...history].slice(0, 100), alerts: alerts.filter((a) => a.binType !== binTypeId) });
    if (justDoneTimer.current) clearTimeout(justDoneTimer.current);
    setJustDone(binTypeId);
    justDoneTimer.current = setTimeout(() => setJustDone(null), 2200);
  }

  function reportFull(binTypeId) {
    if (alerts.find((a) => a.binType === binTypeId)) return;
    const bin = BIN_TYPES.find((b) => b.id === binTypeId);
    if (!bin) return;
    saveState({ alerts: [...alerts, { id: Date.now(), binType: binTypeId, binLabel: bin.label, ts: Date.now() }] });
  }

  function dismissAlert(alertId) { saveState({ alerts: alerts.filter((a) => a.id !== alertId) }); }
  function startEdit(r) { setEditingId(r.id); setEditingName(r.name); }
  function saveEdit(id) {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    saveState({ residents: residents.map((r) => r.id === id ? { ...r, name: trimmed } : r) });
    setEditingId(null); setEditingName("");
  }
  function cancelEdit() { setEditingId(null); setEditingName(""); }
  function toggleActive(id) { saveState({ residents: residents.map((r) => r.id === id ? { ...r, active: !r.active } : r) }); }
  function deleteResident(id) {
    if (editingId === id) cancelEdit();
    saveState({ residents: residents.filter((r) => r.id !== id), history: history.filter((e) => e.personId !== id) });
  }
  function addResident() {
    const trimmed = addingName.trim();
    if (!trimmed) return;
    const newId = Math.max(0, ...residents.map((r) => r.id)) + 1;
    saveState({ residents: [...residents, { id: newId, name: trimmed, active: true }] });
    setAddingName(""); setShowAddForm(false);
  }

  function buildWAMessage() {
    const nextPerson = currentPerson?.name || "?";
    const nextUp     = upNext?.name || "?";
    const fullBins   = alerts.map((a) => a.binLabel).join(" & ");
    const freq       = schedule.frequencyDays === 3 ? "every 3 days" : schedule.frequencyDays === 7 ? "every week" : "every fortnight";
    let msg = `🗑️ *Bin Rota Update*\n\n`;
    if (fullBins) msg += `🚨 *${fullBins} is FULL — needs emptying NOW!*\n\n`;
    msg += `👤 It's *${nextPerson}'s* turn to empty the bins\n`;
    msg += `⏭️ Up next: ${nextUp}\n\n`;
    msg += `📅 Collection day: *${schedule.day}* (${freq})\n\n`;
    msg += `✅ Once done, open the app and tap the bin you emptied.`;
    return msg;
  }

  function copyWAMessage() {
    navigator.clipboard.writeText(buildWAMessage())
      .then(() => { setWaCopied(true); setTimeout(() => setWaCopied(false), 2500); })
      .catch(() => {});
  }

  const cardStyle    = { background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: "16px", overflow: "hidden" };
  const sectionLabel = { fontSize: "12px", fontWeight: "600", color: T.textFaint, letterSpacing: "0.3px", textTransform: "uppercase", marginBottom: "8px" };
  const statusDot    = connStatus === "live" ? T.syncActive : connStatus === "error" ? "#ff453a" : "#f0a500";
  const statusText   = connStatus === "live" ? "Live" : connStatus === "error" ? "Offline" : "Connecting…";

  return (
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:FONT, transition:"background 0.25s, color 0.25s" }}>
      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:0; }
        .btn { cursor:pointer; border:none; font-family:${FONT}; transition:opacity 0.12s, transform 0.1s; border-radius:10px; font-weight:500; }
        .btn:hover { opacity:0.78; }
        .btn:active { transform:scale(0.96); opacity:0.6; }
        .btn:disabled { opacity:0.35; cursor:not-allowed; transform:none; }
        input { outline:none; font-family:${FONT}; }
        .fade-in { animation:fadeIn 0.25s ease; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        .alert-pulse { animation:alertPulse 2.5s infinite; }
        @keyframes alertPulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,59,48,.25)} 50%{box-shadow:0 0 0 7px rgba(255,59,48,0)} }
        .done-pop { animation:donePop 0.35s cubic-bezier(0.175,0.885,0.32,1.275); }
        @keyframes donePop { 0%{transform:scale(0.9);opacity:0} 60%{transform:scale(1.03)} 100%{transform:scale(1);opacity:1} }
      `}</style>

      {/* HEADER */}
      <div style={{ background:T.bgCard, borderBottom:`1px solid ${T.border}`, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:10 }}>
        <div>
          <div style={{ fontSize:"22px", fontWeight:"700", letterSpacing:"-0.5px" }}>Bin Rota</div>
          <div style={{ fontSize:"13px", color:T.textFaint, marginTop:"1px" }}>{activeResidents.length} active · {residents.length - activeResidents.length} away</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
          <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:statusDot, transition:"background 0.4s" }} />
          <div style={{ fontSize:"12px", color:statusDot, fontWeight:"500" }}>{statusText}</div>
          <div style={{ fontSize:"18px" }}>{isDark ? "🌙" : "☀️"}</div>
        </div>
      </div>

      {/* ALERTS */}
      {alerts.length > 0 && (
        <div style={{ padding:"12px 16px 0" }}>
          {alerts.map((alert) => (
            <div key={alert.id} className="alert-pulse fade-in" style={{ background:T.alertBg, border:`1.5px solid ${T.alertBorder}`, borderRadius:"14px", padding:"14px 16px", marginBottom:"10px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                <div style={{ fontSize:"26px" }}>🚨</div>
                <div>
                  <div style={{ fontSize:"15px", fontWeight:"700", color:T.alertText }}>{alert.binLabel} is full</div>
                  <div style={{ fontSize:"13px", color:T.alertSubtext, marginTop:"2px" }}>{currentPerson ? `${currentPerson.name} — please empty it ASAP` : "Needs emptying now"}</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:"8px", flexShrink:0 }}>
                <button className="btn" onClick={() => { markEmptied(alert.binType); dismissAlert(alert.id); }} style={{ background:T.alertText, color:"#fff", padding:"7px 14px", fontSize:"13px", fontWeight:"700" }}>Done ✓</button>
                <button className="btn" onClick={() => dismissAlert(alert.id)} style={{ background:T.bgCard2, color:T.textMuted, padding:"7px 10px", fontSize:"17px", lineHeight:1 }}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TABS */}
      <div style={{ display:"flex", padding:"12px 16px 0", gap:"4px" }}>
        {[["rota","Rota"],["residents","Residents"],["history","History"]].map(([id,lbl]) => (
          <button key={id} className="btn" onClick={() => setActiveTab(id)} style={{ padding:"7px 16px", fontSize:"14px", fontWeight:activeTab===id?"600":"400", background:activeTab===id?T.bgCard:"transparent", color:activeTab===id?T.text:T.textFaint, border:activeTab===id?`1px solid ${T.border}`:"1px solid transparent", boxShadow:activeTab===id?"0 1px 3px rgba(0,0,0,0.08)":"none" }}>{lbl}</button>
        ))}
      </div>

      <div style={{ padding:"16px" }}>

        {/* ROTA TAB */}
        {activeTab === "rota" && (
          <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

            {currentPerson ? (
              <div style={{ background:T.currentBg, border:`1.5px solid ${T.currentBorder}`, borderRadius:"20px", padding:"20px 22px" }}>
                <div style={{ fontSize:"12px", fontWeight:"600", color:T.currentAccent, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:"4px" }}>Current Turn</div>
                <div style={{ fontSize:"36px", fontWeight:"700", letterSpacing:"-1px", color:T.text, marginBottom:"4px" }}>{currentPerson.name}</div>
                {upNext && <div style={{ fontSize:"13px", color:T.textFaint }}>Up next: <span style={{ color:T.textMuted, fontWeight:"500" }}>{upNext.name}</span></div>}
              </div>
            ) : (
              <div style={{ ...cardStyle, padding:"24px", textAlign:"center", color:T.textFaint, fontSize:"15px" }}>No active residents. Add people in the Residents tab.</div>
            )}

            <div>
              <div style={sectionLabel}>✅ Tap when you empty a bin</div>
              <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                {BIN_TYPES.map((bin) => {
                  const isDone = justDone === bin.id;
                  const isFull = !!alerts.find((a) => a.binType === bin.id);
                  if (isDone) return (
                    <div key={bin.id} className="done-pop" style={{ background:T.currentAccentBg, border:`2px solid ${T.currentAccent}`, borderRadius:"18px", padding:"20px 24px", display:"flex", alignItems:"center", gap:"16px" }}>
                      <div style={{ fontSize:"48px" }}>✅</div>
                      <div>
                        <div style={{ fontSize:"18px", fontWeight:"700", color:T.currentAccent }}>Done! Thanks 🙌</div>
                        <div style={{ fontSize:"14px", color:T.textMuted, marginTop:"2px" }}>{bin.label} marked as emptied</div>
                      </div>
                    </div>
                  );
                  return (
                    <button key={bin.id} className="btn" onClick={() => markEmptied(bin.id)} disabled={!currentPerson} style={{ width:"100%", borderRadius:"18px", border:"none", background:isFull?"linear-gradient(135deg,#ff3b30,#c0392b)":isDark?"linear-gradient(135deg,#30d158,#28a745)":"linear-gradient(135deg,#34c759,#2dbe55)", display:"flex", alignItems:"center", overflow:"hidden", boxShadow:isFull?"0 4px 20px rgba(255,59,48,0.4)":"0 4px 20px rgba(52,199,89,0.35)" }}>
                      <div style={{ width:"72px", height:"72px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"32px", background:"rgba(0,0,0,0.12)", flexShrink:0 }}>{bin.emoji}</div>
                      <div style={{ flex:1, textAlign:"left", paddingLeft:"16px" }}>
                        <div style={{ fontSize:"11px", fontWeight:"600", color:"rgba(255,255,255,0.75)", textTransform:"uppercase", marginBottom:"2px" }}>{isFull?"🚨 Full — Tap to confirm emptied":"Tap when emptied"}</div>
                        <div style={{ fontSize:"19px", fontWeight:"700", color:"#fff" }}>{bin.label}</div>
                      </div>
                      <div style={{ width:"56px", height:"72px", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.1)", flexShrink:0, fontSize:"22px", color:"rgba(255,255,255,0.85)" }}>✓</div>
                    </button>
                  );
                })}
              </div>
              {currentPerson && <div style={{ fontSize:"12px", color:T.textFaint, textAlign:"center", marginTop:"10px" }}>{currentPerson.name}, it's your turn — tap the bin you just emptied</div>}
            </div>

            <div>
              <div style={sectionLabel}>Bin Status</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
                {BIN_TYPES.map((bin) => {
                  const isFull = !!alerts.find((a) => a.binType === bin.id);
                  const matchedAlert = alerts.find((a) => a.binType === bin.id);
                  return (
                    <div key={bin.id} style={{ background:isFull?T.alertBg:T.bgCard, border:`1.5px solid ${isFull?T.alertBorder:T.border}`, borderRadius:"14px", padding:"14px", transition:"all 0.2s" }}>
                      <div style={{ fontSize:"24px", marginBottom:"5px" }}>{bin.emoji}</div>
                      <div style={{ fontSize:"14px", fontWeight:"600", marginBottom:"2px" }}>{bin.label}</div>
                      <div style={{ fontSize:"12px", color:isFull?T.alertText:T.currentAccent, fontWeight:"600", marginBottom:"10px" }}>{isFull?"● Full":"● OK"}</div>
                      {!isFull
                        ? <button className="btn" onClick={() => reportFull(bin.id)} style={{ background:T.bgCard2, color:T.textMuted, padding:"7px", fontSize:"12px", width:"100%", border:`1px solid ${T.border}` }}>Report Full</button>
                        : <button className="btn" onClick={() => { markEmptied(bin.id); if(matchedAlert) dismissAlert(matchedAlert.id); }} style={{ background:T.alertText, color:"#fff", padding:"7px", fontSize:"12px", width:"100%", fontWeight:"700" }}>Mark Emptied</button>
                      }
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background:T.waBg, border:`1.5px solid ${T.waBorder}`, borderRadius:"16px", padding:"16px 18px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                  <span style={{ fontSize:"22px" }}>💬</span>
                  <div>
                    <div style={{ fontSize:"15px", fontWeight:"600", color:T.text }}>WhatsApp Reminder</div>
                    <div style={{ fontSize:"12px", color:T.textFaint, marginTop:"1px" }}>Send the rota to your group</div>
                  </div>
                </div>
                <button className="btn" onClick={() => setShowWA((v)=>!v)} style={{ background:T.waGreen, color:"#fff", padding:"7px 14px", fontSize:"13px", fontWeight:"600" }}>{showWA?"Close":"Generate"}</button>
              </div>
              {showWA && (
                <div className="fade-in" style={{ marginTop:"14px" }}>
                  <div style={{ background:isDark?"#0a1a0e":"#dcf8c6", borderRadius:"12px", padding:"14px 16px", fontSize:"13px", lineHeight:"1.65", color:isDark?"#d0f0d8":"#111", whiteSpace:"pre-wrap", marginBottom:"12px", border:`1px solid ${isDark?"#1a4a22":"#b5e7a0"}` }}>{buildWAMessage()}</div>
                  <div style={{ display:"flex", gap:"8px" }}>
                    <button className="btn" onClick={copyWAMessage} style={{ flex:1, background:waCopied?T.currentAccent:T.waGreen, color:"#fff", padding:"11px", fontSize:"14px", fontWeight:"700", transition:"background 0.3s" }}>{waCopied?"✅ Copied!":"📋 Copy Message"}</button>
                    <a href={`https://wa.me/?text=${encodeURIComponent(buildWAMessage())}`} target="_blank" rel="noreferrer" style={{ flex:1, background:T.waGreen, color:"#fff", padding:"11px", fontSize:"14px", fontWeight:"700", borderRadius:"10px", display:"flex", alignItems:"center", justifyContent:"center", textDecoration:"none" }}>Open WhatsApp ↗</a>
                  </div>
                  <div style={{ fontSize:"11px", color:T.textFaint, textAlign:"center", marginTop:"8px" }}>Copy and paste into your house group, or open directly in WhatsApp.</div>
                </div>
              )}
            </div>

            <div>
              <div style={sectionLabel}>Collection Schedule</div>
              <div style={{ ...cardStyle, padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>
                <div>
                  <div style={{ fontSize:"13px", color:T.textFaint, marginBottom:"8px", fontWeight:"500" }}>Collection day</div>
                  <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
                    {DAYS.map((d) => <button key={d} className="btn" onClick={() => saveState({ schedule:{...schedule,day:d} })} style={{ padding:"6px 11px", fontSize:"13px", fontWeight:schedule.day===d?"600":"400", background:schedule.day===d?T.text:T.bgCard2, color:schedule.day===d?T.bg:T.textMuted, border:`1px solid ${schedule.day===d?T.text:T.border}` }}>{d}</button>)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:"13px", color:T.textFaint, marginBottom:"8px", fontWeight:"500" }}>Frequency</div>
                  <div style={{ display:"flex", gap:"6px" }}>
                    {[3,7,14].map((n) => <button key={n} className="btn" onClick={() => saveState({ schedule:{...schedule,frequencyDays:n} })} style={{ padding:"6px 14px", fontSize:"13px", fontWeight:schedule.frequencyDays===n?"600":"400", background:schedule.frequencyDays===n?T.text:T.bgCard2, color:schedule.frequencyDays===n?T.bg:T.textMuted, border:`1px solid ${schedule.frequencyDays===n?T.text:T.border}` }}>{n===3?"3 days":n===7?"Weekly":"Fortnightly"}</button>)}
                  </div>
                </div>
                <div style={{ fontSize:"13px", color:T.textFaint, background:T.bgCard2, borderRadius:"10px", padding:"10px 12px" }}>
                  📅 Every <span style={{ color:T.text, fontWeight:"600" }}>{schedule.frequencyDays===3?"3 days":schedule.frequencyDays===7?"week":"fortnight"}</span> on <span style={{ color:T.text, fontWeight:"600" }}>{schedule.day}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RESIDENTS TAB */}
        {activeTab === "residents" && (
          <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <div style={{ display:"flex", gap:"10px" }}>
              {[{label:"Total",value:residents.length},{label:"Active",value:activeResidents.length,color:T.currentAccent},{label:"Away",value:residents.filter(r=>!r.active).length,color:T.textFaint}].map((stat) => (
                <div key={stat.label} style={{ flex:1, background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:"14px", padding:"12px 14px", textAlign:"center" }}>
                  <div style={{ fontSize:"22px", fontWeight:"700", color:stat.color||T.text }}>{stat.value}</div>
                  <div style={{ fontSize:"12px", color:T.textFaint, marginTop:"2px" }}>{stat.label}</div>
                </div>
              ))}
            </div>
            <button className="btn" onClick={() => { setShowAddForm((v)=>!v); setAddingName(""); }} style={{ width:"100%", padding:"13px", fontSize:"15px", fontWeight:"600", background:showAddForm?T.bgCard2:T.currentAccent, color:showAddForm?T.textMuted:"#fff", border:`1px solid ${showAddForm?T.border:T.currentAccent}` }}>
              {showAddForm ? "Cancel" : "+ Add Person"}
            </button>
            {showAddForm && (
              <div className="fade-in" style={{ display:"flex", gap:"8px" }}>
                <input type="text" value={addingName} onChange={(e)=>setAddingName(e.target.value)} onKeyDown={(e)=>{ if(e.key==="Enter") addResident(); if(e.key==="Escape"){ setShowAddForm(false); setAddingName(""); } }} placeholder="Enter name…" autoFocus style={{ flex:1, background:T.bgInput, border:`1px solid ${T.border}`, borderRadius:"10px", padding:"10px 14px", color:T.text, fontSize:"15px" }} />
                <button className="btn" onClick={addResident} style={{ background:T.currentAccent, color:"#fff", padding:"10px 20px", fontSize:"15px", fontWeight:"600" }}>Add</button>
              </div>
            )}
            <div style={cardStyle}>
              {residents.length === 0 && <div style={{ padding:"28px", textAlign:"center", color:T.textFaint, fontSize:"14px" }}>No residents yet. Tap "+ Add Person" above.</div>}
              {residents.map((r, idx) => {
                const isCurrent = r.id === currentPerson?.id;
                const turnCount = history.filter((h) => h.personId === r.id).length;
                return (
                  <div key={r.id} style={{ padding:"14px 16px", borderBottom:idx<residents.length-1?`1px solid ${T.border}`:"none", display:"flex", alignItems:"center", gap:"12px", opacity:r.active?1:0.45, transition:"opacity 0.2s" }}>
                    <div style={{ width:"38px", height:"38px", borderRadius:"50%", flexShrink:0, background:isCurrent&&r.active?T.currentAccentBg:T.bgCard2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"16px", fontWeight:"700", color:isCurrent&&r.active?T.currentAccent:T.textFaint }}>
                      {r.name.charAt(0).toUpperCase()}
                    </div>
                    {editingId === r.id ? (
                      <input type="text" value={editingName} onChange={(e)=>setEditingName(e.target.value)} onKeyDown={(e)=>{ if(e.key==="Enter") saveEdit(r.id); if(e.key==="Escape") cancelEdit(); }} autoFocus style={{ flex:1, background:T.bgInput, border:`1px solid ${T.border}`, borderRadius:"8px", padding:"6px 10px", color:T.text, fontSize:"15px" }} />
                    ) : (
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"6px", flexWrap:"wrap" }}>
                          <span style={{ fontSize:"15px", fontWeight:"500" }}>{r.name}</span>
                          {isCurrent&&r.active && <span style={{ fontSize:"11px", background:T.currentAccentBg, color:T.currentAccent, padding:"1px 7px", borderRadius:"20px", fontWeight:"600" }}>Current</span>}
                          {!r.active && <span style={{ fontSize:"11px", background:T.pillBg, color:T.textFaint, padding:"1px 7px", borderRadius:"20px", fontWeight:"500" }}>Away ✈️</span>}
                        </div>
                        <div style={{ fontSize:"12px", color:T.textFaint, marginTop:"1px" }}>{turnCount} turn{turnCount!==1?"s":""}</div>
                      </div>
                    )}
                    {editingId === r.id ? (
                      <div style={{ display:"flex", gap:"6px" }}>
                        <button className="btn" onClick={()=>saveEdit(r.id)} style={{ background:T.currentAccent, color:"#fff", padding:"6px 14px", fontSize:"13px", fontWeight:"600" }}>Save</button>
                        <button className="btn" onClick={cancelEdit} style={{ background:T.bgCard2, color:T.textMuted, padding:"6px 10px", fontSize:"16px", border:`1px solid ${T.border}` }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                        <Toggle checked={r.active} onChange={()=>toggleActive(r.id)} color={T.toggleColor} />
                        <button className="btn" onClick={()=>startEdit(r)} style={{ background:"transparent", color:T.textFaint, padding:"4px", fontSize:"17px", border:"none" }}>✏️</button>
                        <button className="btn" onClick={()=>deleteResident(r.id)} style={{ background:"transparent", color:T.removeBtnText, padding:"4px", fontSize:"17px", border:"none", opacity:0.6 }}>🗑️</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize:"12px", color:T.textFaint, textAlign:"center", lineHeight:1.5 }}>Toggle the switch to mark someone as away.<br/>They'll be skipped in the rota until you turn them back on.</div>
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === "history" && (
          <div className="fade-in">
            <div style={sectionLabel}>Emptying Log</div>
            {history.length === 0 ? (
              <div style={{ textAlign:"center", padding:"60px 20px", color:T.textVeryFaint, fontSize:"15px", lineHeight:1.6 }}>No history yet.<br/>Tap a bin button to start the log.</div>
            ) : (
              <div style={cardStyle}>
                {history.map((h, idx) => {
                  const bin = BIN_TYPES.find((b) => b.id === h.binType);
                  return (
                    <div key={h.id} style={{ padding:"13px 16px", borderBottom:idx<history.length-1?`1px solid ${T.border}`:"none", display:"flex", alignItems:"center", gap:"12px" }}>
                      <div style={{ fontSize:"22px" }}>{bin?.emoji||"🗑️"}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:"15px" }}><span style={{ fontWeight:"600" }}>{h.personName}</span><span style={{ color:T.textMuted }}> emptied {bin?.label||h.binType}</span></div>
                        <div style={{ fontSize:"12px", color:T.textFaint, marginTop:"2px" }}>{h.date}</div>
                      </div>
                      <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:T.currentAccent, opacity:0.5, flexShrink:0 }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div style={{ textAlign:"center", padding:"24px 20px 32px", borderTop:`1px solid ${T.footerBorder}`, marginTop:"8px" }}>
        <div style={{ fontSize:"12px", color:T.footerText, marginBottom:"6px" }}>Real-time sync · data stored securely in Firebase</div>
        <div style={{ fontSize:"13px", color:T.textFaint }}>Made with ♥ by <span style={{ color:T.currentAccent, fontWeight:"600" }}>Yassine</span></div>
      </div>
    </div>
  );
}
