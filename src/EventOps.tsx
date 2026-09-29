import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BatteryCharging, Check, CirclePause, CirclePlay, Flag,
  Lock, RefreshCw, RotateCcw, Shuffle, Trophy, Unlock, Users, Zap
} from 'lucide-react';
import { api } from './lib/api';
import { TEAM_NAMES } from './lib/booking';
import type { AdminSession } from './BusinessConsole';

type Participant = {
  id: string;
  name: string;
  waiverSigned: boolean;
  checkedIn: boolean;
  teamIndex: number;
  equipmentCode: string;
  active: boolean;
};
type Round = {
  id: string;
  roundNo: number;
  teamA: number;
  teamB: number;
  mode: string;
  durationSeconds: number;
  status: 'pending' | 'live' | 'paused' | 'completed';
  startedAt: string;
  elapsedSeconds: number;
  endedAt: string;
  scoreA: number;
  scoreB: number;
  objectiveA: number;
  objectiveB: number;
  notes: string;
};
type Equipment = {
  code: string;
  status: string;
  battery: number;
  notes: string;
  updatedAt: string;
};
type Incident = {
  id: string;
  at: string;
  kind: string;
  note: string;
  resolved: boolean;
  resolvedAt: string;
};
type Standing = {
  teamIndex: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scored: number;
  conceded: number;
  objectives: number;
};
type EventData = {
  serverNow: string;
  bookingId: string;
  reference: string;
  expectedPlayers: number;
  registeredPlayers: number;
  rosterTeamSizes: number[];
  profile: {
    eventName: string;
    organization: string;
    groupType: string;
    ageGroup: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    objectives: string;
    accessibilityNotes: string;
    photoConsent: boolean;
    rosterLocked: boolean;
    eventStatus: string;
  };
  participants: Participant[];
  rounds: Round[];
  leaderboard: Standing[];
  equipment: Equipment[];
  incidents: Incident[];
};

const teamName = (index: number) => TEAM_NAMES[index] || `TEAM ${index + 1}`;
const clock = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

export default function EventOps({ bookingId, session }: { bookingId: string; session: AdminSession }) {
  const [data, setData] = useState<EventData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const [mode, setMode] = useState('Team Battle');
  const [roundMinutes, setRoundMinutes] = useState(10);
  const [incidentKind, setIncidentKind] = useState('safety');
  const [incidentNote, setIncidentNote] = useState('');

  const load = async () => {
    setError('');
    try { setData(await api<EventData>(`/api/admin/events/${bookingId}`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load event operations.'); }
  };
  useEffect(() => { load(); }, [bookingId]);
  useEffect(() => {
    if (!data?.rounds.some((round) => round.status === 'live')) return;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [data?.rounds]);

  const teams = useMemo(() => {
    const result = new Map<number, Participant[]>();
    for (const person of data?.participants.filter((item) => item.active) ?? []) {
      const key = person.teamIndex;
      result.set(key, [...(result.get(key) ?? []), person]);
    }
    return [...result.entries()].sort(([a],[b])=>a-b);
  }, [data]);

  async function request(path: string, method: 'POST' | 'PATCH', body: unknown, message = 'Event plan updated.') {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<EventData>(path, {
        method,
        headers: { 'X-CSRF-Token': session.csrf },
        body: JSON.stringify(body)
      });
      setData(result); setTick(Date.now()); setNotice(message);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update event plan.'); }
    finally { setBusy(false); }
  }

  const command = (path: string, body: unknown, message?: string) =>
    request(path, 'POST', body, message);

  async function patchParticipant(person: Participant, patch: Partial<Participant>) {
    await request(
      `/api/admin/events/${bookingId}/participants/${person.id}`,
      'PATCH',
      patch,
      'Participant updated.'
    );
  }

  async function patchEquipment(item: Equipment, patch: Partial<Equipment>) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/api/admin/equipment/${item.code}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': session.csrf },
        body: JSON.stringify({ status: patch.status ?? item.status, battery: patch.battery ?? item.battery, notes: patch.notes ?? item.notes })
      });
      await load(); setNotice(`${item.code} updated.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update equipment.'); }
    finally { setBusy(false); }
  }

  async function incident(event: FormEvent) {
    event.preventDefault();
    if (!incidentNote.trim()) return;
    await command(
      `/api/admin/events/${bookingId}/incidents`,
      { kind: incidentKind, note: incidentNote },
      'Incident logged.'
    );
    setIncidentNote('');
  }

  const liveRound = data?.rounds.find((round) => round.status === 'live');
  const elapsedNow = (round: Round) => {
    if (!data) return round.elapsedSeconds;
    if (round.status !== 'live') return round.elapsedSeconds;
    const sinceSnapshot = Math.max(0, Math.floor((tick - Date.parse(data.serverNow)) / 1000));
    return round.elapsedSeconds + sinceSnapshot;
  };

  if (!data) return <div className="admin-customer-notes"><h3>EVENT OPERATIONS</h3>{error ? <p role="alert">{error}</p> : <p>Loading event plan…</p>}</div>;

  return (
    <div className="admin-history">
      <div className="admin-panel-header">
        <span><Users size={15}/> EVENT OPERATIONS</span>
        <button className="admin-text-button" type="button" onClick={load}><RefreshCw size={14}/> Refresh</button>
      </div>

      <dl className="admin-facts">
        <div><dt>Event</dt><dd>{data.profile.eventName || '—'}</dd></div>
        <div><dt>Organization</dt><dd>{data.profile.organization || '—'}</dd></div>
        <div><dt>Registration</dt><dd>{data.registeredPlayers} / {data.expectedPlayers}</dd></div>
        <div><dt>Balanced teams</dt><dd>{data.rosterTeamSizes.join(' / ') || '—'}</dd></div>
        <div><dt>Age group</dt><dd>{data.profile.ageGroup}</dd></div>
        <div><dt>Event state</dt><dd>{data.profile.eventStatus.toUpperCase()}</dd></div>
      </dl>
      {data.profile.objectives && <div className="admin-customer-notes"><h3>EVENT GOALS</h3><p>{data.profile.objectives}</p></div>}
      {data.profile.accessibilityNotes && <div className="admin-customer-notes"><h3>ACCESSIBILITY / SETUP</h3><p>{data.profile.accessibilityNotes}</p></div>}

      <div className="nav-actions">
        <button type="button" className="secondary-action" disabled={busy || data.profile.rosterLocked}
          onClick={()=>command(`/api/admin/events/${bookingId}/rebalance`,{randomize:false})}><Users size={15}/> BALANCE</button>
        <button type="button" className="secondary-action" disabled={busy || data.profile.rosterLocked}
          onClick={()=>command(`/api/admin/events/${bookingId}/rebalance`,{randomize:true})}><Shuffle size={15}/> RANDOMIZE</button>
        <button type="button" className="secondary-action" disabled={busy}
          onClick={()=>command(`/api/admin/events/${bookingId}/lock`,{locked:!data.profile.rosterLocked})}>
          {data.profile.rosterLocked ? <Unlock size={15}/> : <Lock size={15}/>}
          {data.profile.rosterLocked ? 'UNLOCK TEAMS' : 'LOCK TEAMS'}
        </button>
      </div>

      {notice && <p className="demo-note" role="status">{notice}</p>}
      {error && <p className="prototype-warning" role="alert">{error}</p>}

      <div className="business-table">
        <table>
          <thead><tr><th>Participant</th><th>Team</th><th>Waiver</th><th>Check-in</th><th>Tagger</th><th>Active</th></tr></thead>
          <tbody>
            {data.participants.map((person) => (
              <tr key={person.id}>
                <td>{person.name}</td>
                <td><select value={person.teamIndex} disabled={busy}
                  onChange={(event)=>patchParticipant(person,{teamIndex:Number(event.target.value)})}>
                  <option value={-1}>Unassigned</option>
                  {Array.from({length:Math.max(2,data.rosterTeamSizes.length)},(_,index)=>
                    <option value={index} key={index}>{teamName(index)}</option>)}
                </select></td>
                <td><input aria-label={`Waiver for ${person.name}`} type="checkbox" checked={person.waiverSigned} disabled={busy}
                  onChange={(event)=>patchParticipant(person,{waiverSigned:event.target.checked})}/></td>
                <td><input aria-label={`Check in ${person.name}`} type="checkbox" checked={person.checkedIn} disabled={busy}
                  onChange={(event)=>patchParticipant(person,{checkedIn:event.target.checked})}/></td>
                <td><select value={person.equipmentCode || ''} disabled={busy}
                  onChange={(event)=>patchParticipant(person,{equipmentCode:event.target.value} as Partial<Participant>)}>
                  <option value="">None</option>
                  {data.equipment.map((gear)=><option value={gear.code} key={gear.code} disabled={['maintenance','damaged'].includes(gear.status)}>{gear.code} · {gear.battery}%</option>)}
                </select></td>
                <td><label className="tactical-checkbox inline-check"><input type="checkbox" checked={person.active} disabled={busy}
                  onChange={(event)=>patchParticipant(person,{active:event.target.checked})}/><span className="checkbox-box"><Check size={12}/></span></label></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {teams.length > 0 && <p className="admin-help">Current teams: {teams.map(([index,members])=>`${teamName(index)}: ${members.length}`).join(' · ')}</p>}

      <section className="admin-customer-notes">
        <div className="admin-panel-header"><span><BatteryCharging size={15}/> EQUIPMENT READINESS</span>
          <button type="button" className="admin-text-button" disabled={busy} onClick={()=>command(`/api/admin/events/${bookingId}/equipment/auto-assign`,{},'Checked-in players assigned to available taggers.')}><Zap size={14}/> Auto assign</button>
        </div>
        <div className="business-table"><table><thead><tr><th>Tagger</th><th>Status</th><th>Battery</th><th>Notes</th></tr></thead><tbody>
          {data.equipment.map((gear)=><tr key={gear.code}>
            <td>{gear.code}</td>
            <td><select value={gear.status} disabled={busy} onChange={(e)=>patchEquipment(gear,{status:e.target.value})}>
              <option value="available">Available</option><option value="assigned">Assigned</option><option value="charging">Charging</option><option value="maintenance">Maintenance</option><option value="damaged">Damaged</option>
            </select></td>
            <td><input type="number" min={0} max={100} value={gear.battery} disabled={busy} onChange={(e)=>setData(current=>current ? {...current,equipment:current.equipment.map(item=>item.code===gear.code?{...item,battery:Number(e.target.value)}:item)}:current)} onBlur={(e)=>patchEquipment({...gear,battery:Number(e.target.value)},{battery:Number(e.target.value)})}/>%</td>
            <td><input maxLength={500} value={gear.notes} disabled={busy} onChange={(e)=>setData(current=>current ? {...current,equipment:current.equipment.map(item=>item.code===gear.code?{...item,notes:e.target.value}:item)}:current)} onBlur={(e)=>patchEquipment({...gear,notes:e.target.value},{notes:e.target.value})}/></td>
          </tr>)}
        </tbody></table></div>
      </section>

      <section className="admin-customer-notes">
        <div className="admin-panel-header"><span><Flag size={15}/> MISSION CONTROL</span><strong>{liveRound ? `LIVE · ${clock(Math.max(0,liveRound.durationSeconds-elapsedNow(liveRound)))}` : 'STANDBY'}</strong></div>
        <div className="admin-edit-grid">
          <label>Game mode<input value={mode} maxLength={80} onChange={(e)=>setMode(e.target.value)}/></label>
          <label>Round minutes<input type="number" min={5} max={30} value={roundMinutes} onChange={(e)=>setRoundMinutes(Number(e.target.value))}/></label>
          <button type="button" className="primary-action" disabled={busy || data.registeredPlayers < 2}
            onClick={()=>command(`/api/admin/events/${bookingId}/rounds/generate`,{mode,durationMinutes:roundMinutes},'Round-robin mission schedule generated.')}>
            <RotateCcw size={16}/> GENERATE SCHEDULE
          </button>
        </div>
        <div className="nav-actions">
          {['registration','ready','live','complete'].map((status)=><button type="button" className="secondary-action" key={status} disabled={busy || data.profile.eventStatus===status}
            onClick={()=>command(`/api/admin/events/${bookingId}/status`,{status},`Event marked ${status}.`)}>{status.toUpperCase()}</button>)}
        </div>

        <div className="business-table"><table><thead><tr><th>#</th><th>Match</th><th>Mode</th><th>Timer</th><th>Score</th><th>Control</th></tr></thead><tbody>
          {data.rounds.map((round)=><tr key={round.id}>
            <td>{round.roundNo}</td><td>{teamName(round.teamA)} vs {teamName(round.teamB)}</td><td>{round.mode}</td>
            <td>{clock(Math.max(0,round.durationSeconds-elapsedNow(round)))}<br/><small>{round.status}</small></td>
            <td>
              <input aria-label={`Score ${teamName(round.teamA)}`} type="number" min={0} defaultValue={round.scoreA} style={{width:55}}
                onBlur={(e)=>request(`/api/admin/events/${bookingId}/rounds/${round.id}`,'PATCH',{action:'score',scoreA:Number(e.target.value),scoreB:round.scoreB,objectiveA:round.objectiveA,objectiveB:round.objectiveB,notes:round.notes},'Score saved.')}/>
              {' - '}
              <input aria-label={`Score ${teamName(round.teamB)}`} type="number" min={0} defaultValue={round.scoreB} style={{width:55}}
                onBlur={(e)=>request(`/api/admin/events/${bookingId}/rounds/${round.id}`,'PATCH',{action:'score',scoreA:round.scoreA,scoreB:Number(e.target.value),objectiveA:round.objectiveA,objectiveB:round.objectiveB,notes:round.notes},'Score saved.')}/>
            </td>
            <td><div className="nav-actions">
              {round.status==='pending' && <button type="button" className="admin-icon-button" disabled={busy} onClick={()=>request(`/api/admin/events/${bookingId}/rounds/${round.id}`,'PATCH',{action:'start'},'Round started.')}><CirclePlay size={16}/></button>}
              {round.status==='live' && <button type="button" className="admin-icon-button" disabled={busy} onClick={()=>request(`/api/admin/events/${bookingId}/rounds/${round.id}`,'PATCH',{action:'pause'},'Round paused.')}><CirclePause size={16}/></button>}
              {round.status==='paused' && <button type="button" className="admin-icon-button" disabled={busy} onClick={()=>request(`/api/admin/events/${bookingId}/rounds/${round.id}`,'PATCH',{action:'resume'},'Round resumed.')}><CirclePlay size={16}/></button>}
              {round.status!=='completed' && <button type="button" className="admin-icon-button" disabled={busy} onClick={()=>request(`/api/admin/events/${bookingId}/rounds/${round.id}`,'PATCH',{action:'complete',scoreA:round.scoreA,scoreB:round.scoreB,objectiveA:round.objectiveA,objectiveB:round.objectiveB,notes:round.notes},'Round completed.')}><Check size={16}/></button>}
            </div></td>
          </tr>)}
        </tbody></table></div>
        {data.rounds.length>0 && <button type="button" className="secondary-action" disabled={busy || data.leaderboard.length<2}
          onClick={()=>command(`/api/admin/events/${bookingId}/final`,{durationMinutes:10},'Championship final added from the top two teams.')}><Trophy size={16}/> ADD CHAMPIONSHIP FINAL</button>}
      </section>

      <section className="admin-customer-notes">
        <div className="panel-label"><Trophy size={15}/> LIVE LEADERBOARD</div>
        <div className="business-table"><table><thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Pts</th><th>Score +/-</th><th>Obj</th></tr></thead><tbody>
          {data.leaderboard.map((row)=><tr key={row.teamIndex}><td>{teamName(row.teamIndex)}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td><strong>{row.points}</strong></td><td>{row.scored-row.conceded}</td><td>{row.objectives}</td></tr>)}
        </tbody></table></div>
      </section>

      <section className="admin-customer-notes">
        <div className="panel-label"><AlertTriangle size={15}/> INCIDENT LOG</div>
        <form className="admin-edit-grid" onSubmit={incident}>
          <label>Type<select value={incidentKind} onChange={(e)=>setIncidentKind(e.target.value)}><option value="safety">Safety</option><option value="equipment">Equipment</option><option value="weather">Weather</option><option value="venue">Venue</option><option value="other">Other</option></select></label>
          <label>Note<input required maxLength={1000} value={incidentNote} onChange={(e)=>setIncidentNote(e.target.value)}/></label>
          <button className="secondary-action" disabled={busy}><AlertTriangle size={15}/> LOG INCIDENT</button>
        </form>
        <div className="business-table"><table><thead><tr><th>Time</th><th>Type</th><th>Note</th><th>Status</th></tr></thead><tbody>
          {data.incidents.map((item)=><tr key={item.id}><td>{new Date(item.at).toLocaleString()}</td><td>{item.kind}</td><td>{item.note}</td><td><button type="button" className="admin-text-button" disabled={busy} onClick={()=>request(`/api/admin/events/${bookingId}/incidents/${item.id}`,'PATCH',{resolved:!item.resolved},item.resolved?'Incident reopened.':'Incident resolved.')}>{item.resolved?'Resolved':'Open'}</button></td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
