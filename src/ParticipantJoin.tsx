import { FormEvent, useEffect, useState } from 'react';
import { BadgeCheck, Check, ShieldCheck, UserPlus } from 'lucide-react';
import Brand from './Brand';
import { api } from './lib/api';
import { formatTime } from './lib/booking';
import './admin.css';

type EventInfo = {
  reference: string;
  date: string;
  time: string;
  mission: string;
  eventName: string;
  organization: string;
  ageGroup: string;
  expectedPlayers: number;
  registeredPlayers: number;
  rosterLocked: boolean;
};

export default function ParticipantJoin() {
  const token = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [form, setForm] = useState({
    name:'', email:'', phone:'', guardianName:'', guardianPhone:'', safetyAcknowledged:false
  });
  const [checkInUrl,setCheckInUrl]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{ api<EventInfo>(`/api/join/${token}`).then(setEvent).catch((e)=>setError(e instanceof Error?e.message:'Unable to load event.')); },[token]);

  async function submit(e:FormEvent){
    e.preventDefault(); setBusy(true); setError('');
    try{
      const result=await api<{registered:boolean;checkInUrl:string}>(`/api/join/${token}`,{method:'POST',body:JSON.stringify(form)});
      setCheckInUrl(result.checkInUrl);
    }catch(err){setError(err instanceof Error?err.message:'Registration failed.');}
    finally{setBusy(false);}
  }

  if(error&&!event) return <div className="app-shell"><header className="topbar"><Brand/></header><main className="page-frame"><section className="hud-panel account-form narrow-panel"><ShieldCheck size={34}/><h1>INVITE UNAVAILABLE</h1><p role="alert">{error}</p><a className="primary-action" href="/">BACK TO COMBATZONE</a></section></main></div>;
  if(!event) return <p role="status">Loading event invitation…</p>;
  if(checkInUrl) return <div className="app-shell"><header className="topbar"><Brand/></header><main className="page-frame"><section className="hud-panel account-form narrow-panel"><BadgeCheck size={42}/><p className="eyebrow">REGISTRATION COMPLETE</p><h1>YOU’RE ON THE ROSTER.</h1><p>Keep your private check-in link. It identifies your registration for event day.</p><a className="primary-action" href={checkInUrl}>OPEN MY CHECK-IN PASS</a><a className="secondary-action" href="/">BACK TO COMBATZONE</a></section></main></div>;

  const minor=['children','teens'].includes(event.ageGroup);
  return <div className="app-shell"><header className="topbar"><Brand/><div className="status-chip"><span className="status-dot"/> PARTICIPANT REGISTRATION</div></header><main className="page-frame panel-stack">
    <section className="hud-panel section-block"><p className="eyebrow">MISSION INVITE / {event.reference}</p><h1>{event.eventName||event.mission}</h1><p>{event.organization&&`${event.organization} · `}{event.date} · {formatTime(event.time)}</p><p>{event.registeredPlayers} of {event.expectedPlayers} players registered.</p>{event.rosterLocked&&<p className="prototype-warning">Registration changes are locked by Mission Control.</p>}</section>
    <form className="hud-panel account-form narrow-panel" onSubmit={submit}>
      <div className="panel-label"><UserPlus size={15}/> JOIN THE ROSTER</div>
      <label><span>Participant name</span><input required maxLength={120} value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
      <label><span>Email — optional</span><input type="email" maxLength={254} value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></label>
      <label><span>Phone — optional</span><input type="tel" maxLength={30} value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></label>
      {minor&&<><label><span>Parent / guardian name</span><input required maxLength={120} value={form.guardianName} onChange={(e)=>setForm({...form,guardianName:e.target.value})}/></label><label><span>Guardian phone</span><input required type="tel" maxLength={30} value={form.guardianPhone} onChange={(e)=>setForm({...form,guardianPhone:e.target.value})}/></label></>}
      <label className="tactical-checkbox inline-check"><input type="checkbox" required checked={form.safetyAcknowledged} onChange={(e)=>setForm({...form,safetyAcknowledged:e.target.checked})}/><span className="checkbox-box"><Check size={14}/></span><span>I confirm that I will follow the safety briefing, marshal instructions and venue rules. Participation remains subject to CombatZone’s event-day safety assessment.</span></label>
      {error&&<p className="prototype-warning" role="alert">{error}</p>}
      <button className="primary-action" disabled={busy||event.rosterLocked}>{busy?'REGISTERING…':'JOIN EVENT'}</button>
    </form>
  </main></div>;
}
