import { useEffect, useMemo, useState } from 'react';
import { Check, Lock, RefreshCw, Shuffle, Unlock, Users } from 'lucide-react';
import { api } from './lib/api';
import { TEAM_NAMES } from './lib/booking';
import type { AdminSession } from './BusinessConsole';

type Participant = {
  id: string;
  name: string;
  waiverSigned: boolean;
  checkedIn: boolean;
  teamIndex: number;
  active: boolean;
};
type EventData = {
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
};

export default function EventOps({ bookingId, session }: { bookingId: string; session: AdminSession }) {
  const [data, setData] = useState<EventData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    try { setData(await api<EventData>(`/api/admin/events/${bookingId}`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load event operations.'); }
  };
  useEffect(() => { load(); }, [bookingId]);

  const teams = useMemo(() => {
    const result = new Map<number, Participant[]>();
    for (const person of data?.participants.filter((item) => item.active) ?? []) {
      const key = person.teamIndex;
      result.set(key, [...(result.get(key) ?? []), person]);
    }
    return [...result.entries()].sort(([a],[b])=>a-b);
  }, [data]);

  async function command(path: string, body: unknown) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<EventData>(path, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrf },
        body: JSON.stringify(body)
      });
      setData(result); setNotice('Event plan updated.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update event plan.'); }
    finally { setBusy(false); }
  }

  async function patchParticipant(person: Participant, patch: Partial<Participant>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<EventData>(
        `/api/admin/events/${bookingId}/participants/${person.id}`,
        {
          method: 'PATCH',
          headers: { 'X-CSRF-Token': session.csrf },
          body: JSON.stringify(patch)
        }
      );
      setData(result); setNotice('Participant updated.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update participant.'); }
    finally { setBusy(false); }
  }

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
        <div><dt>Emergency contact</dt><dd>{data.profile.emergencyContactName}<br/>{data.profile.emergencyContactPhone}</dd></div>
      </dl>
      {data.profile.objectives && <div className="admin-customer-notes"><h3>EVENT GOALS</h3><p>{data.profile.objectives}</p></div>}
      {data.profile.accessibilityNotes && <div className="admin-customer-notes"><h3>ACCESSIBILITY / SETUP</h3><p>{data.profile.accessibilityNotes}</p></div>}
      <div className="nav-actions">
        <button type="button" className="secondary-action" disabled={busy || data.profile.rosterLocked}
          onClick={()=>command(`/api/admin/events/${bookingId}/rebalance`,{randomize:false})}>
          <Users size={15}/> BALANCE TEAMS
        </button>
        <button type="button" className="secondary-action" disabled={busy || data.profile.rosterLocked}
          onClick={()=>command(`/api/admin/events/${bookingId}/rebalance`,{randomize:true})}>
          <Shuffle size={15}/> RANDOMIZE
        </button>
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
          <thead><tr><th>Participant</th><th>Team</th><th>Waiver</th><th>Check-in</th><th>Active</th></tr></thead>
          <tbody>
            {data.participants.map((person) => (
              <tr key={person.id}>
                <td>{person.name}</td>
                <td>
                  <select value={person.teamIndex} disabled={busy}
                    onChange={(event)=>patchParticipant(person,{teamIndex:Number(event.target.value)})}>
                    <option value={-1}>Unassigned</option>
                    {Array.from({length:Math.max(2,data.rosterTeamSizes.length)},(_,index)=>
                      <option value={index} key={index}>{TEAM_NAMES[index] || `Team ${index+1}`}</option>
                    )}
                  </select>
                </td>
                <td><input aria-label={`Waiver for ${person.name}`} type="checkbox" checked={person.waiverSigned} disabled={busy}
                  onChange={(event)=>patchParticipant(person,{waiverSigned:event.target.checked})}/></td>
                <td><input aria-label={`Check in ${person.name}`} type="checkbox" checked={person.checkedIn} disabled={busy}
                  onChange={(event)=>patchParticipant(person,{checkedIn:event.target.checked})}/></td>
                <td><label className="tactical-checkbox inline-check"><input type="checkbox" checked={person.active} disabled={busy}
                  onChange={(event)=>patchParticipant(person,{active:event.target.checked})}/><span className="checkbox-box"><Check size={12}/></span></label></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {teams.length > 0 && <p className="admin-help">Current team sizes: {teams.map(([index,members])=>`${TEAM_NAMES[index] || index+1}: ${members.length}`).join(' · ')}</p>}
    </div>
  );
}
