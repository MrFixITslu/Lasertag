import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Check, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
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
};

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
  name: '',
  email: '',
  phone: '',
  guardianName: '',
  guardianPhone: '',
  waiverSigned: false
};

export default function RegistrationPortal() {
  const token = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const [data, setData] = useState<PortalData | null>(null);
  const [profile, setProfile] = useState<PortalData['profile'] | null>(null);
  const [participant, setParticipant] = useState(emptyParticipant);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    setError('');
    try {
      const result = await api<PortalData>(`/api/portal/${token}`);
      setData(result);
      setProfile(result.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load registration.');
    }
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
    event.preventDefault();
    if (!profile) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<PortalData>(`/api/portal/${token}/profile`, {
        method: 'PUT',
        body: JSON.stringify(profile)
      });
      setData(result); setProfile(result.profile); setNotice('Event information saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save event information.');
    } finally { setBusy(false); }
  }

  async function addParticipant(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<PortalData>(`/api/portal/${token}/participants`, {
        method: 'POST',
        body: JSON.stringify(participant)
      });
      setData(result); setParticipant(emptyParticipant); setNotice('Participant added and teams rebalanced.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add participant.');
    } finally { setBusy(false); }
  }

  async function updateParticipant(item: Participant, patch: Partial<Participant>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<PortalData>(`/api/portal/${token}/participants/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      setData(result); setNotice('Participant updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update participant.');
    } finally { setBusy(false); }
  }

  async function removeParticipant(item: Participant) {
    if (!window.confirm(`Remove ${item.name} from this roster?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<PortalData>(`/api/portal/${token}/participants/${item.id}`, {
        method: 'DELETE'
      });
      setData(result); setNotice('Participant removed and teams rebalanced.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove participant.');
    } finally { setBusy(false); }
  }

  if (error && !data) {
    return <div className="app-shell"><header className="topbar"><Brand /></header>
      <main className="page-frame"><section className="hud-panel account-form narrow-panel">
        <ShieldCheck size={34} /><h1>REGISTRATION LINK UNAVAILABLE</h1><p role="alert">{error}</p><a href="/" className="primary-action">BACK TO COMBATZONE</a>
      </section></main></div>;
  }
  if (!data || !profile) return <p role="status">Loading registration…</p>;

  const complete = Math.min(100, Math.round((data.registeredPlayers / Math.max(1, data.expectedPlayers)) * 100));
  return (
    <div className="app-shell">
      <header className="topbar"><Brand /><div className="status-chip"><span className="status-dot" /> PRIVATE EVENT REGISTRATION</div></header>
      <main className="page-frame panel-stack">
        <section className="hud-panel section-block">
          <div className="admin-panel-header"><span>{data.reference}</span><button className="admin-text-button" onClick={refresh}><RefreshCw size={14}/> Refresh</button></div>
          <p className="eyebrow">PRE-MISSION REGISTRATION</p>
          <h1>{profile.eventName || data.mission}</h1>
          <p>{data.mission} · {data.date} · {formatTime(data.time)} · booking {data.status}</p>
          <div className="admin-stats">
            <div><span>Expected</span><strong>{data.expectedPlayers}</strong></div>
            <div><span>Registered</span><strong>{data.registeredPlayers}</strong></div>
            <div><span>Complete</span><strong>{complete}%</strong></div>
            <div><span>Teams</span><strong>{data.rosterTeamSizes.join(' / ') || '—'}</strong></div>
          </div>
          {profile.rosterLocked && <p className="prototype-warning"><ShieldCheck size={15}/> Teams are locked by Mission Control. Contact CombatZone for roster changes.</p>}
          {notice && <p className="demo-note" role="status">{notice}</p>}
          {error && <p className="prototype-warning" role="alert">{error}</p>}
        </section>

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
          {teams.length === 0 ? <p>Add participant names to generate the team plan.</p> : teams.map(([index, members]) => (
            <div className="squad-row" key={index}>
              <div className="squad-name"><span>TEAM</span><strong>{index === 99 ? 'UNASSIGNED' : TEAM_NAMES[index] || `TEAM ${index + 1}`}</strong></div>
              <div className="operators">{members.map((member)=><span className="operator active" title={member.name} key={member.id}><Users size={15}/></span>)}</div>
              <span className="squad-count">{members.length}</span>
            </div>
          ))}
          <p className="demo-note">Teams are rebalanced automatically while registration remains open. Mission Control can randomize, manually adjust, then lock final teams.</p>
        </section>

        <section className="hud-panel section-block">
          <div className="panel-heading-row"><div className="panel-label">PARTICIPANT ROSTER</div><span className="panel-hint">{data.registeredPlayers}/{data.expectedPlayers} expected</span></div>
          <div className="business-table"><table><thead><tr><th>Name</th><th>Team</th><th>Waiver</th><th></th></tr></thead><tbody>
            {data.participants.filter((item)=>item.active).map((item)=><tr key={item.id}>
              <td>{item.name}</td><td>{item.teamIndex >= 0 ? TEAM_NAMES[item.teamIndex] || item.teamIndex + 1 : '—'}</td>
              <td><label className="tactical-checkbox inline-check"><input type="checkbox" disabled={busy || profile.rosterLocked} checked={item.waiverSigned} onChange={(e)=>updateParticipant(item,{waiverSigned:e.target.checked})}/><span className="checkbox-box"><Check size={12}/></span><span>{item.waiverSigned ? 'Acknowledged' : 'Pending'}</span></label></td>
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
          <button className="primary-action" disabled={busy || profile.rosterLocked}><UserPlus size={17}/> ADD TO ROSTER</button>
        </form>

        <section className="hud-panel section-block">
          <BadgeCheck size={28}/><h2>WHAT HAPPENS NEXT?</h2>
          <p>Finish the roster before event day. CombatZone will review the venue, final teams, equipment assignments and mission schedule before the event is confirmed.</p>
        </section>
      </main>
    </div>
  );
}
