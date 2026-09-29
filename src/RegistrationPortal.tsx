import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck, Check, Copy, ExternalLink, Image, RefreshCw, ShieldCheck,
  Star, Trash2, Trophy, UserPlus, Users
} from 'lucide-react';
import Brand from './Brand';
import { api } from './lib/api';
import { TEAM_NAMES, formatTime } from './lib/booking';
import './admin.css';

type Participant = {
  id: string;
  name: string;
  email: string;
  phone: string;
  guardianName: string;
  guardianPhone: string;
  waiverSigned: boolean;
  checkedIn: boolean;
  teamIndex: number;
  active: boolean;
  checkInUrl: string;
};
type Round = {
  id:string; roundNo:number; teamA:number; teamB:number; mode:string; status:string;
  scoreA:number; scoreB:number; objectiveA:number; objectiveB:number;
};
type Standing = {
  teamIndex:number; played:number; wins:number; draws:number; losses:number;
  points:number; scored:number; conceded:number; objectives:number;
};
type GalleryItem = { id:string; label:string; name:string; mime:string; url:string };
type PortalData = {
  bookingId: string;
  reference: string;
  status: string;
  date: string;
  time: string;
  mission: string;
  expectedPlayers: number;
  expectedTeamSizes: number[];
  registeredPlayers: number;
  rosterTeamSizes: number[];
  joinUrl: string;
  rounds: Round[];
  leaderboard: Standing[];
  gallery: GalleryItem[];
  feedback: {rating:number;comment:string;createdAt:string}[];
  profile: {
    eventName: string;
    organization: string;
    groupType: string;
    ageGroup: string;
    objectives: string;
    accessibilityNotes: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    photoConsent: boolean;
    rosterLocked: boolean;
    eventStatus: string;
  };
  participants: Participant[];
};

const emptyParticipant = {
  name: '', email: '', phone: '', guardianName: '', guardianPhone: '', waiverSigned: false
};
const teamName=(index:number)=>TEAM_NAMES[index] || `TEAM ${index+1}`;

export default function RegistrationPortal() {
  const token = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const [data, setData] = useState<PortalData | null>(null);
  const [profile, setProfile] = useState<PortalData['profile'] | null>(null);
  const [participant, setParticipant] = useState(emptyParticipant);
  const [rating,setRating]=useState(5);
  const [feedback,setFeedback]=useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    setError('');
    try {
      const result = await api<PortalData>(`/api/portal/${token}`);
      setData(result); setProfile(result.profile);
      if(result.feedback[0]) { setRating(result.feedback[0].rating); setFeedback(result.feedback[0].comment); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load registration.'); }
  };
  useEffect(() => { refresh(); }, [token]);

  const teams = useMemo(() => {
    const grouped = new Map<number, Participant[]>();
    for (const item of data?.participants.filter((entry) => entry.active) ?? []) {
      const key = item.teamIndex < 0 ? 99 : item.teamIndex;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a - b);
  }, [data]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); if (!profile) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<PortalData>(`/api/portal/${token}/profile`, { method: 'PUT', body: JSON.stringify(profile) });
      setData(result); setProfile(result.profile); setNotice('Event information saved.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save event information.'); }
    finally { setBusy(false); }
  }
  async function addParticipant(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<PortalData>(`/api/portal/${token}/participants`, { method: 'POST', body: JSON.stringify(participant) });
      setData(result); setParticipant(emptyParticipant); setNotice('Participant added and teams rebalanced.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add participant.'); }
    finally { setBusy(false); }
  }
  async function updateParticipant(item: Participant, patch: Partial<Participant>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<PortalData>(`/api/portal/${token}/participants/${item.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setData(result); setNotice('Participant updated.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update participant.'); }
    finally { setBusy(false); }
  }
  async function removeParticipant(item: Participant) {
    if (!window.confirm(`Remove ${item.name} from this roster?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<PortalData>(`/api/portal/${token}/participants/${item.id}`, { method: 'DELETE' });
      setData(result); setNotice('Participant removed and teams rebalanced.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not remove participant.'); }
    finally { setBusy(false); }
  }
  async function submitFeedback(event:FormEvent){
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try{
      await api(`/api/portal/${token}/feedback`,{method:'POST',body:JSON.stringify({rating,comment:feedback})});
      setNotice('Thanks — your feedback was saved.'); await refresh();
    }catch(err){setError(err instanceof Error?err.message:'Could not save feedback.');}
    finally{setBusy(false);}
  }
  async function copy(value:string,label:string){
    try{ await navigator.clipboard.writeText(value); setNotice(`${label} copied.`); }
    catch{ setNotice('Copy unavailable. Open the link and share it from your browser.'); }
  }

  if (error && !data) return <div className="app-shell"><header className="topbar"><Brand /></header>
    <main className="page-frame"><section className="hud-panel account-form narrow-panel">
      <ShieldCheck size={34} /><h1>REGISTRATION LINK UNAVAILABLE</h1><p role="alert">{error}</p><a href="/" className="primary-action">BACK TO COMBATZONE</a>
    </section></main></div>;
  if (!data || !profile) return <p role="status">Loading registration…</p>;

  const complete = Math.min(100, Math.round((data.registeredPlayers / Math.max(1, data.expectedPlayers)) * 100));
  const inviteToken=data.joinUrl.split('/').filter(Boolean).at(-1) || '';
  return <div className="app-shell">
    <header className="topbar"><Brand /><div className="status-chip"><span className="status-dot" /> PRIVATE EVENT HUB</div></header>
    <main className="page-frame panel-stack">
      <section className="hud-panel section-block">
        <div className="admin-panel-header"><span>{data.reference}</span><button className="admin-text-button" onClick={refresh}><RefreshCw size={14}/> Refresh</button></div>
        <p className="eyebrow">EVENT REGISTRATION & RESULTS</p>
        <h1>{profile.eventName || data.mission}</h1>
        <p>{data.mission} · {data.date} · {formatTime(data.time)} · booking {data.status}</p>
        <div className="admin-stats">
          <div><span>Expected</span><strong>{data.expectedPlayers}</strong></div>
          <div><span>Registered</span><strong>{data.registeredPlayers}</strong></div>
          <div><span>Complete</span><strong>{complete}%</strong></div>
          <div><span>Event state</span><strong>{profile.eventStatus.toUpperCase()}</strong></div>
        </div>
        {profile.rosterLocked && <p className="prototype-warning"><ShieldCheck size={15}/> Teams are locked by Mission Control.</p>}
        {notice && <p className="demo-note" role="status">{notice}</p>}
        {error && <p className="prototype-warning" role="alert">{error}</p>}
      </section>

      {data.joinUrl && <section className="hud-panel section-block">
        <div className="panel-label">PARTICIPANT SELF-REGISTRATION</div>
        <p>Share this private event invite so players can enter their own details before game day. They cannot see anyone else’s contact information.</p>
        {inviteToken && <img src={`/api/portal/${token}/join-qr`} alt="Participant self-registration QR code" width="220" height="220"/>}
        <div className="nav-actions">
          <a className="primary-action" href={data.joinUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/> OPEN INVITE</a>
          <button type="button" className="secondary-action" onClick={()=>copy(data.joinUrl,'Participant invite')}><Copy size={15}/> COPY LINK</button>
        </div>
      </section>}

      <form className="hud-panel account-form" onSubmit={saveProfile}>
        <div className="panel-label">EVENT INFORMATION</div>
        <label><span>Event / Group Name</span><input maxLength={120} value={profile.eventName} onChange={(e)=>setProfile({...profile,eventName:e.target.value})}/></label>
        <label><span>Organization</span><input maxLength={120} value={profile.organization} onChange={(e)=>setProfile({...profile,organization:e.target.value})}/></label>
        <label><span>Group Type</span><select value={profile.groupType} onChange={(e)=>setProfile({...profile,groupType:e.target.value})}>
          <option value="birthday">Birthday / private party</option><option value="corporate">Corporate / team building</option><option value="school">School / youth group</option><option value="community">Community / festival</option><option value="resort">Hotel / resort</option><option value="friends">Friends / social group</option><option value="other">Other</option>
        </select></label>
        <label><span>Age Group</span><select value={profile.ageGroup} onChange={(e)=>setProfile({...profile,ageGroup:e.target.value})}>
          <option value="children">Children</option><option value="teens">Teens</option><option value="adults">Adults</option><option value="mixed">Mixed ages</option>
        </select></label>
        <label><span>Emergency Contact</span><input required maxLength={120} value={profile.emergencyContactName} onChange={(e)=>setProfile({...profile,emergencyContactName:e.target.value})}/></label>
        <label><span>Emergency Phone</span><input required type="tel" maxLength={30} value={profile.emergencyContactPhone} onChange={(e)=>setProfile({...profile,emergencyContactPhone:e.target.value})}/></label>
        <label><span>Goals / Preferences</span><textarea rows={3} maxLength={1000} value={profile.objectives} onChange={(e)=>setProfile({...profile,objectives:e.target.value})}/></label>
        <label><span>Accessibility / Setup Notes</span><textarea rows={3} maxLength={1000} value={profile.accessibilityNotes} onChange={(e)=>setProfile({...profile,accessibilityNotes:e.target.value})}/></label>
        <label className="tactical-checkbox inline-check"><input type="checkbox" checked={profile.photoConsent} onChange={(e)=>setProfile({...profile,photoConsent:e.target.checked})}/><span className="checkbox-box"><Check size={14}/></span><span>Organizer is open to event photography/media, subject to individual consent where required.</span></label>
        <button className="primary-action" disabled={busy}>SAVE EVENT INFO</button>
      </form>

      <section className="hud-panel section-block">
        <div className="panel-label">BALANCED TEAM PLAN</div>
        {teams.length === 0 ? <p>Add participant names to generate the team plan.</p> : teams.map(([index, members]) => <div className="squad-row" key={index}>
          <div className="squad-name"><span>TEAM</span><strong>{index === 99 ? 'UNASSIGNED' : teamName(index)}</strong></div>
          <div className="operators">{members.map((member)=><span className="operator active" title={member.name} key={member.id}><Users size={15}/></span>)}</div>
          <span className="squad-count">{members.length}</span>
        </div>)}
        <p className="demo-note">Teams stay balanced while registration is open. Mission Control may randomize, adjust and lock the final teams.</p>
      </section>

      <section className="hud-panel section-block">
        <div className="panel-heading-row"><div className="panel-label">PARTICIPANT ROSTER</div><span className="panel-hint">{data.registeredPlayers}/{data.expectedPlayers} expected</span></div>
        <div className="business-table"><table><thead><tr><th>Name</th><th>Team</th><th>Safety</th><th>Check-in</th><th></th></tr></thead><tbody>
          {data.participants.filter((item)=>item.active).map((item)=><tr key={item.id}>
            <td>{item.name}</td><td>{item.teamIndex >= 0 ? teamName(item.teamIndex) : '—'}</td>
            <td>{item.waiverSigned?'Ready':'Pending'}</td>
            <td>{item.checkedIn?'Checked in':item.checkInUrl?<a href={item.checkInUrl} target="_blank" rel="noreferrer">Pass ↗</a>:'Pending'}</td>
            <td><button type="button" className="admin-icon-button" disabled={busy || profile.rosterLocked} onClick={()=>removeParticipant(item)} aria-label={`Remove ${item.name}`}><Trash2 size={15}/></button></td>
          </tr>)}
        </tbody></table></div>
      </section>

      <form className="hud-panel account-form" onSubmit={addParticipant}>
        <div className="panel-label"><UserPlus size={15}/> ADD PARTICIPANT</div>
        <label><span>Participant Name</span><input required maxLength={120} value={participant.name} onChange={(e)=>setParticipant({...participant,name:e.target.value})}/></label>
        <label><span>Email — optional</span><input type="email" maxLength={254} value={participant.email} onChange={(e)=>setParticipant({...participant,email:e.target.value})}/></label>
        <label><span>Phone — optional</span><input type="tel" maxLength={30} value={participant.phone} onChange={(e)=>setParticipant({...participant,phone:e.target.value})}/></label>
        {(profile.ageGroup === 'children' || profile.ageGroup === 'teens' || profile.ageGroup === 'mixed') && <>
          <label><span>Parent / Guardian — when applicable</span><input maxLength={120} value={participant.guardianName} onChange={(e)=>setParticipant({...participant,guardianName:e.target.value})}/></label>
          <label><span>Guardian Phone</span><input type="tel" maxLength={30} value={participant.guardianPhone} onChange={(e)=>setParticipant({...participant,guardianPhone:e.target.value})}/></label>
        </>}
        <label className="tactical-checkbox inline-check"><input type="checkbox" checked={participant.waiverSigned} onChange={(e)=>setParticipant({...participant,waiverSigned:e.target.checked})}/><span className="checkbox-box"><Check size={14}/></span><span>Safety/participation acknowledgement has been completed for this participant.</span></label>
        <button className="primary-action" disabled={busy || profile.rosterLocked || data.registeredPlayers>=data.expectedPlayers}><UserPlus size={17}/> ADD TO ROSTER</button>
      </form>

      {data.rounds.length>0 && <section className="hud-panel section-block">
        <div className="panel-label"><Trophy size={15}/> MATCHES & RESULTS</div>
        <div className="business-table"><table><thead><tr><th>#</th><th>Match</th><th>Mode</th><th>Status</th><th>Score</th></tr></thead><tbody>
          {data.rounds.map((round)=><tr key={round.id}><td>{round.roundNo}</td><td>{teamName(round.teamA)} vs {teamName(round.teamB)}</td><td>{round.mode}</td><td>{round.status}</td><td>{round.status==='completed'?`${round.scoreA} - ${round.scoreB}`:'—'}</td></tr>)}
        </tbody></table></div>
        {data.leaderboard.length>0 && <div className="business-table"><table><thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Pts</th></tr></thead><tbody>
          {data.leaderboard.map((row)=><tr key={row.teamIndex}><td>{teamName(row.teamIndex)}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td><strong>{row.points}</strong></td></tr>)}
        </tbody></table></div>}
      </section>}

      {data.gallery.length>0 && <section className="hud-panel section-block">
        <div className="panel-label"><Image size={15}/> EVENT GALLERY</div>
        <div className="mission-grid">{data.gallery.map(item=><a className="mission-card" href={item.url} target="_blank" rel="noreferrer" key={item.id}><strong>{item.label||item.name}</strong><span>{item.mime}</span></a>)}</div>
      </section>}

      {profile.eventStatus==='complete' && <form className="hud-panel account-form" onSubmit={submitFeedback}>
        <div className="panel-label"><Star size={15}/> EVENT FEEDBACK</div>
        <label><span>Rating</span><select value={rating} onChange={(e)=>setRating(Number(e.target.value))}>{[5,4,3,2,1].map(value=><option key={value} value={value}>{value} / 5</option>)}</select></label>
        <label><span>Comments</span><textarea rows={4} maxLength={2000} value={feedback} onChange={(e)=>setFeedback(e.target.value)} placeholder="What worked well? What should we improve?"/></label>
        <button className="primary-action" disabled={busy}>SAVE FEEDBACK</button>
        <a className="secondary-action" href="/#booking">BOOK ANOTHER MISSION</a>
      </form>}

      <section className="hud-panel section-block">
        <BadgeCheck size={28}/><h2>EVENT PREPARATION</h2>
        <p>Complete the roster and safety details before event day. CombatZone will finalize the venue, teams, equipment and mission schedule before the event begins.</p>
      </section>
    </main>
  </div>;
}
