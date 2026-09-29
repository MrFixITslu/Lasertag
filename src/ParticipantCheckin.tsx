import { FormEvent, useEffect, useState } from 'react';
import { BadgeCheck, Check, ShieldCheck } from 'lucide-react';
import Brand from './Brand';
import { api } from './lib/api';
import { TEAM_NAMES, formatTime } from './lib/booking';
import './admin.css';

type Pass = {
  name:string; reference:string; date:string; time:string; mission:string; eventName:string;
  organization:string; ageGroup:string; eventStatus:string; teamIndex:number; checkedIn:boolean;
  safetyAcknowledged:boolean; guardianName:string; guardianPhone:string;
};

export default function ParticipantCheckin(){
  const token=window.location.pathname.split('/').filter(Boolean)[1]||'';
  const [pass,setPass]=useState<Pass|null>(null);
  const [guardianName,setGuardianName]=useState('');
  const [guardianPhone,setGuardianPhone]=useState('');
  const [ack,setAck]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  const load=()=>api<Pass>(`/api/checkin/${token}`).then((p)=>{setPass(p);setGuardianName(p.guardianName||'');setGuardianPhone(p.guardianPhone||'');setAck(p.safetyAcknowledged);}).catch((e)=>setError(e instanceof Error?e.message:'Unable to load check-in pass.'));
  useEffect(()=>{load();},[token]);

  async function submit(e:FormEvent){
    e.preventDefault(); setBusy(true); setError('');
    try{await api(`/api/checkin/${token}`,{method:'POST',body:JSON.stringify({safetyAcknowledged:ack,guardianName,guardianPhone})});await load();}
    catch(err){setError(err instanceof Error?err.message:'Check-in failed.');}
    finally{setBusy(false);}
  }

  if(error&&!pass) return <div className="app-shell"><header className="topbar"><Brand/></header><main className="page-frame"><section className="hud-panel account-form narrow-panel"><ShieldCheck size={34}/><h1>CHECK-IN PASS UNAVAILABLE</h1><p>{error}</p></section></main></div>;
  if(!pass) return <p role="status">Loading check-in pass…</p>;
  const minor=['children','teens'].includes(pass.ageGroup);
  return <div className="app-shell"><header className="topbar"><Brand/><div className="status-chip"><span className="status-dot"/> EVENT CHECK-IN</div></header><main className="page-frame panel-stack">
    <section className="hud-panel account-form narrow-panel">
      {pass.checkedIn?<BadgeCheck size={44}/>:<ShieldCheck size={44}/>}
      <p className="eyebrow">{pass.reference} / {pass.eventStatus.toUpperCase()}</p>
      <h1>{pass.name}</h1>
      <p>{pass.eventName||pass.mission} · {pass.date} · {formatTime(pass.time)}</p>
      <p><strong>TEAM {pass.teamIndex>=0?(TEAM_NAMES[pass.teamIndex]||pass.teamIndex+1):'TO BE ASSIGNED'}</strong></p>
      <img src={`/api/checkin/${token}/qr`} alt="Participant check-in QR code" width="240" height="240"/>
      {pass.checkedIn?<p className="demo-note">Check-in complete. Show this pass to Mission Control if requested.</p>:<form className="form-stack" onSubmit={submit}>
        {minor&&<><label><span>Parent / guardian name</span><input required maxLength={120} value={guardianName} onChange={(e)=>setGuardianName(e.target.value)}/></label><label><span>Guardian phone</span><input required type="tel" maxLength={30} value={guardianPhone} onChange={(e)=>setGuardianPhone(e.target.value)}/></label></>}
        <label className="tactical-checkbox inline-check"><input required type="checkbox" checked={ack} onChange={(e)=>setAck(e.target.checked)}/><span className="checkbox-box"><Check size={14}/></span><span>I acknowledge the event safety rules and agree to follow the game marshal’s instructions.</span></label>
        {error&&<p className="prototype-warning" role="alert">{error}</p>}
        <button className="primary-action" disabled={busy}>{busy?'CHECKING IN…':'COMPLETE CHECK-IN'}</button>
      </form>}
    </section>
  </main></div>;
}
