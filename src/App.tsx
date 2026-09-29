import { visitId, campaignId } from './lib/analytics';
import { api } from './lib/api';
import Brand from './Brand';
import Landing from './Landing';
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  CreditCard,
  Crosshair,
  Hotel,
  Mail,
  MapPin,
  PartyPopper,
  Phone,
  Radar,
  RotateCcw,
  ShieldCheck,
  Target,
  TentTree,
  UserRound,
  Users,
  WalletCards,
  Zap
} from 'lucide-react';
import { directBookMissions, missions, requestMissions } from './data/missions';
import {
  buildDateChoices,
  calculateBookingSummary,
  fixedStartTimes,
  formatDuration,
  formatTime,
  validCustomer,
  isPrivateDeploymentVenue,
  TEAM_NAMES
} from './lib/booking';
import type { BookingDraft, MissionPackage } from './types';

type BookingStage = 'mission' | 'squad' | 'deployment' | 'details' | 'account' | 'review';
type MissionFilter = 'instant' | 'request';

const stageOrder: BookingStage[] = ['mission', 'squad', 'deployment', 'details', 'account', 'review'];
const stageLabels = ['Mission', 'Teams', 'Deployment', 'Registration', 'Operator', 'Confirm'];

const venueTypes = [
  { id: 'home', label: 'Home / Private Property', icon: MapPin },
  { id: 'field', label: 'Playing Field', icon: TentTree },
  { id: 'community', label: 'Community Facility', icon: Building2 },
  { id: 'hotel', label: 'Hotel / Resort', icon: Hotel },
  { id: 'event', label: 'Event Venue', icon: PartyPopper },
  { id: 'other', label: 'Other Location', icon: Target }
];

const initialDraft: BookingDraft = {
  missionId: '',
  players: 6,
  date: '',
  time: '',
  venueType: '',
  area: '',
  address: '',
  weatherFlexible: false,
  notes: '',
  eventDetails: {
    eventName: '',
    organization: '',
    groupType: 'other',
    ageGroup: 'mixed',
    emergencyContactName: '',
    emergencyContactPhone: '',
    objectives: '',
    accessibilityNotes: '',
    photoConsent: false,
    participantNames: []
  },
  customer: {
    fullName: '',
    email: '',
    phone: '',
    marketingOptIn: false
  }
};

function money(value: number, currency: 'XCD' | 'USD') {
  return `${currency === 'XCD' ? 'EC$' : 'US$'}${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}

function getMission(id: string) {
  return missions.find((mission) => mission.id === id);
}

const Admin = lazy(() => import('./Admin'));
const RegistrationPortal = lazy(() => import('./RegistrationPortal'));
const ParticipantJoin = lazy(() => import('./ParticipantJoin'));
const ParticipantCheckin = lazy(() => import('./ParticipantCheckin'));
function App() {
  if (/^\/admin\/?$/.test(window.location.pathname)) {
    return <Suspense fallback={<p role="status">Loading booking control…</p>}><Admin /></Suspense>;
  }
  if (/^\/manage\/[a-f0-9]{64}\/?$/i.test(window.location.pathname)) {
    return <Suspense fallback={<p role="status">Loading registration portal…</p>}><RegistrationPortal /></Suspense>;
  }
  if (/^\/join\/[a-f0-9]{64}\/?$/i.test(window.location.pathname)) {
    return <Suspense fallback={<p role="status">Loading participant registration…</p>}><ParticipantJoin /></Suspense>;
  }
  if (/^\/checkin\/[a-f0-9]{48}\/?$/i.test(window.location.pathname)) {
    return <Suspense fallback={<p role="status">Loading check-in pass…</p>}><ParticipantCheckin /></Suspense>;
  }
  return <PublicApp />;
}

function PublicApp() {
  const [booking, setBooking] = useState(() => window.location.hash === '#booking');
  useEffect(() => {
    const navigate = () => {
      const next = window.location.hash === '#booking';
      setBooking(next);
      if (next || !window.location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    document.title = booking ? 'CombatZone SLU — Mission Booking' : 'CombatZone SLU — Real World. Game On.';
    if (booking) document.querySelector<HTMLElement>('.brand-lockup')?.focus();
  }, [booking]);
  return booking ? <BookingApp /> : <Landing />;
}

function BookingApp() {
  const [stage, setStage] = useState<BookingStage>('mission');
  const [filter, setFilter] = useState<MissionFilter>('instant');
  const [draft, setDraft] = useState<BookingDraft>(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const request = useRef<{ body: string; key: string } | null>(null);
  const [receipt, setReceipt] = useState<{ reference: string; portalToken: string } | null>(null);
  const [submitError, setSubmitError] = useState('');

  const selectedMission = getMission(draft.missionId);
  const dates = useMemo(() => buildDateChoices(12), []);
  const summary = selectedMission
    ? calculateBookingSummary(selectedMission, draft.players, {
        privateDeployment: isPrivateDeploymentVenue(draft.venueType)
      })
    : null;

  const activeMissionList = filter === 'instant' ? directBookMissions : requestMissions;
  const currentStep = stageOrder.indexOf(stage);

  const updateDraft = <K extends keyof BookingDraft>(key: K, value: BookingDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const selectMission = (mission: MissionPackage) => {
    setDraft((current) => ({
      ...current,
      missionId: mission.id,
      players: Math.max(current.players, mission.minPlayers),
      eventDetails: {
        ...current.eventDetails,
        groupType: ['birthday','corporate','school','community','resort'].includes(mission.category)
          ? mission.category as BookingDraft['eventDetails']['groupType']
          : current.eventDetails.groupType
      }
    }));
    setStage('squad');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = () => {
    const index = stageOrder.indexOf(stage);
    if (index <= 0) {
      setStage('mission');
      return;
    }
    setStage(stageOrder[index - 1]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goForward = () => {
    const index = stageOrder.indexOf(stage);
    if (index < 0 || index >= stageOrder.length - 1) return;
    setStage(stageOrder[index + 1]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deploymentComplete =
    Boolean(draft.date) &&
    Boolean(draft.time) &&
    Boolean(draft.venueType) &&
    Boolean(draft.area.trim()) &&
    Boolean(draft.address.trim());

  const registrationComplete =
    Boolean(draft.eventDetails.emergencyContactName.trim()) &&
    draft.eventDetails.emergencyContactPhone.replace(/\D/g, '').length >= 7;
  const accountComplete = validCustomer(draft.customer);

  const finalizeMission = async () => {
    if (inFlight.current || !selectedMission || !deploymentComplete || !registrationComplete || !accountComplete) return;
    const body = JSON.stringify({...draft,visitId:visitId(),campaignId:campaignId()});
    if (!request.current || request.current.body !== body) request.current = { body, key: crypto.randomUUID() };
    inFlight.current = true; setSubmitting(true); setSubmitError('');
    try {
      const result = await api<{ reference: string; portalToken: string }>('/api/bookings', {
        method: 'POST', headers: { 'Idempotency-Key': request.current.key }, body
      });
      setReceipt({ reference: result.reference, portalToken: result.portalToken });
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (error) { setSubmitError(error instanceof Error ? error.message : 'Could not send your request. Please try again.'); }
    finally { inFlight.current = false; setSubmitting(false); }
  };

  if (receipt) return (
    <div className="app-shell"><header className="topbar"><Brand /></header>
      <main className="page-frame"><section className="hud-panel account-form narrow-panel" role="status">
        <BadgeCheck size={40} /><p className="eyebrow">REQUEST RECEIVED / PENDING REVIEW</p>
        <h1>YOUR MISSION IS IN.</h1><p>Your reference: <strong>{receipt.reference}</strong></p>
        <p>Your request has been saved for our team to review. Your slot is not yet confirmed and no payment has been taken. Use your private registration link to finish the roster, participant details and event preparation before game day.</p>
        <a className="primary-action" href={`/manage/${receipt.portalToken}`}>COMPLETE REGISTRATION</a>
        <a className="secondary-action" href="/">BACK TO COMBATZONE</a>
      </section></main></div>
  );

  return (
    <div className="app-shell">
      <TacticalBackdrop />

      <header className="topbar">
        <Brand className="brand-lockup" />

        <div className="status-chip">
          <span className="status-dot" />
          ISLAND-WIDE DEPLOYMENT
        </div>
      </header>

      {(
        <nav className="mission-progress" aria-label="Booking progress">
          {stageLabels.map((label, index) => {
            const isComplete = currentStep > index;
            const isActive = currentStep === index;
            return (
              <div
                key={label}
                aria-current={isActive ? "step" : undefined}
                className={`progress-step ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}
              >
                <div className="progress-node">
                  {isComplete ? <Check size={13} /> : String(index + 1).padStart(2, '0')}
                </div>
                <span>{label}</span>
              </div>
            );
          })}
        </nav>
      )}

      <main className="page-frame">
        <p className="demo-note" role="status">Standard package pricing and customer play time are shown. Scheduling buffers cover setup and turnaround and are not extra play time. Availability, travel outside the Gros Islet/Castries core area, venue requirements and custom arrangements are confirmed by our team; no online payment is taken.</p>
        {submitError && <p className="prototype-warning" role="alert">{submitError}</p>}
        {stage === 'mission' && (
          <MissionSelect
            filter={filter}
            setFilter={setFilter}
            missions={activeMissionList}
            onSelect={selectMission}
          />
        )}

        {stage === 'squad' && selectedMission && summary && (
          <SquadBuilder
            mission={selectedMission}
            players={draft.players}
            summary={summary}
            onPlayersChange={(players) => updateDraft('players', players)}
            onBack={goBack}
            onNext={goForward}
          />
        )}

        {stage === 'deployment' && selectedMission && summary && (
          <DeploymentStep
            draft={draft}
            updateDraft={updateDraft}
            dates={dates}
            mission={selectedMission}
            summary={summary}
            onBack={goBack}
            onNext={goForward}
            canContinue={deploymentComplete}
          />
        )}

        {stage === 'details' && selectedMission && (
          <EventDetailsStep
            draft={draft}
            setDraft={setDraft}
            onBack={goBack}
            onNext={goForward}
            canContinue={registrationComplete}
          />
        )}

        {stage === 'account' && selectedMission && (
          <AccountStep
            draft={draft}
            setDraft={setDraft}
            onBack={goBack}
            onNext={goForward}
            canContinue={accountComplete}
          />
        )}

        {stage === 'review' && selectedMission && summary && (
          <ReviewStep
            mission={selectedMission}
            draft={draft}
            summary={summary}
            onBack={goBack}
            onFinalize={finalizeMission}
            submitting={submitting}
          />
        )}

      </main>

      <footer className="footer">
        <span>COMBATZONE SLU / MISSION BOOKING</span>
        <span>Safety decisions always override weather preference.</span>
      </footer>
    </div>
  );
}

function TacticalBackdrop() {
  return (
    <div className="tactical-backdrop" aria-hidden="true">
      <div className="grid-plane" />
      <div className="radar radar-one">
        <div className="radar-sweep" />
      </div>
      <div className="radar radar-two">
        <div className="radar-sweep" />
      </div>
      <div className="scan-line" />
      <div className="noise-layer" />
    </div>
  );
}

function MissionSelect({
  filter,
  setFilter,
  missions,
  onSelect
}: {
  filter: MissionFilter;
  setFilter: (filter: MissionFilter) => void;
  missions: MissionPackage[];
  onSelect: (mission: MissionPackage) => void;
}) {
  return (
    <section className="hero-stack">
      <div className="eyebrow">
        <Radar size={16} />
        MISSION CONTROL ONLINE
      </div>

      <div className="hero-copy">
        <div>
          <h1>
            SELECT YOUR
            <span> MISSION.</span>
          </h1>
          <p>
            Assemble your squad, choose your deployment window, and bring the battle to your location.
          </p>
        </div>

        <div className="hero-reticle">
          <div className="reticle-core">
            <Crosshair size={50} />
          </div>
          <span>TARGET AREA</span>
          <strong>SAINT LUCIA</strong>
        </div>
      </div>

      <div className="mode-toggle">
        <button
          className={filter === 'instant' ? 'active' : ''}
          onClick={() => setFilter('instant')}
          type="button"
        >
          <Zap size={16} />
          EXPLORE PACKAGES
          <small>Public, birthdays & events</small>
        </button>
        <button
          className={filter === 'request' ? 'active' : ''}
          onClick={() => setFilter('request')}
          type="button"
        >
          <ShieldCheck size={16} />
          REQUEST A MISSION
          <small>Corporate & resort operations</small>
        </button>
      </div>

      <div className="mission-grid">
        {missions.map((mission, index) => (
          <button
            key={mission.id}
            className="mission-card"
            onClick={() => onSelect(mission)}
            type="button"
            style={{ '--mission-delay': `${index * 55}ms` } as React.CSSProperties}
          >
            <div className="card-scan" />
            <div className="mission-card-top">
              <div>
                <span className="call-sign">{mission.callSign}</span>
                <h2>{mission.name}</h2>
              </div>
              <div className="target-icon">
                <Target size={18} />
              </div>
            </div>

            <p>{mission.description}</p>

            <div className="tag-row">
              {mission.highlights.map((highlight) => (
                <span key={highlight}>{highlight}</span>
              ))}
            </div>

            <div className="mission-card-footer">
              <div>
                <span className="meta-label">
                  {mission.priceLabel || (mission.pricingMode === 'per_participant' ? 'PER PLAYER' : mission.bookingMode === 'request' ? 'FROM' : 'PACKAGE')}
                </span>
                <strong>{money(mission.price, mission.currency)}</strong>
              </div>
              <div>
                <span className="meta-label">{mission.timeLabel || 'BASE TIME'}</span>
                <strong>{formatDuration(mission.durationMinutes)}</strong>
              </div>
              <div className="deploy-link">
                {mission.bookingMode === 'instant' ? 'DEPLOY' : 'BRIEF US'}
                <ChevronRight size={16} />
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="intel-strip">
        <div>
          <Users size={17} />
          <span>STARTING SQUAD</span>
          <strong>FROM 6 PLAYERS</strong>
        </div>
        <div>
          <Crosshair size={17} />
          <span>ACTIVE AT ONCE</span>
          <strong>12 PLAYERS</strong>
        </div>
        <div>
          <MapPin size={17} />
          <span>DEPLOYMENT</span>
          <strong>ISLAND-WIDE</strong>
        </div>
        <div>
          <CalendarDays size={17} />
          <span>START WINDOWS</span>
          <strong>08:00–16:00</strong>
        </div>
      </div>
    </section>
  );
}

function SquadBuilder({
  mission,
  players,
  summary,
  onPlayersChange,
  onBack,
  onNext
}: {
  mission: MissionPackage;
  players: number;
  summary: ReturnType<typeof calculateBookingSummary>;
  onPlayersChange: (players: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const teams = summary.teamSizes;
  const teamName = (index: number) => TEAM_NAMES[index] || `TEAM ${index + 1}`;
  const matchRotation = summary.matchRotation
    .map(([left, right]) => `${teamName(left)} vs ${teamName(right)}`)
    .join(' • ');

  return (
    <section className="panel-stack">
      <StageHeading
        number="02"
        eyebrow="TEAM CONFIGURATION"
        title="BUILD BALANCED TEAMS."
        text="CombatZone automatically divides the group as evenly as possible. Teams differ by no more than one player, with up to six players per team."
      />

      <div className="two-column-layout">
        <div className="hud-panel squad-control">
          <div className="hud-corners" />
          <div className="selected-mission-mini">
            <span>{mission.callSign}</span>
            <strong>{mission.name}</strong>
          </div>

          <div className="player-counter">
            <button
              type="button"
              onClick={() => onPlayersChange(Math.max(mission.minPlayers, players - 1))}
              disabled={players <= mission.minPlayers}
              aria-label="Remove player"
            >
              −
            </button>
            <div>
              <strong>{players}</strong>
              <span>PLAYERS</span>
            </div>
            <button
              type="button"
              onClick={() => onPlayersChange(Math.min(60, players + 1))}
              aria-label="Add player"
            >
              +
            </button>
          </div>

          <div className="quick-counts">
            {[mission.minPlayers, 12, 18, 24, 30]
              .filter((count, index, values) => count >= mission.minPlayers && values.indexOf(count) === index)
              .map((count) => (
              <button
                type="button"
                className={players === count ? 'active' : ''}
                onClick={() => onPlayersChange(count)}
                key={count}
              >
                {count}
              </button>
            ))}
          </div>

          <div className="rotation-rule">
            <RotateCcw size={18} />
            <div>
              <strong>ROTATION PROTOCOL</strong>
              <span>
                {summary.customQuoteRequired
                  ? mission.customQuoteMessage || 'This group size requires a custom quotation.'
                  : mission.rotationExtensionMinutes === 0
                    ? 'Planned rotations stay inside the purchased play window; extra time is not added automatically.'
                    : `Additional groups beyond ${mission.rotationIncludedPlayers ?? mission.maxConcurrentPlayers} players add ${formatDuration(mission.rotationExtensionMinutes ?? 30)} per started rotation group.`}
              </span>
            </div>
          </div>
        </div>

        <div className="hud-panel">
          <div className="panel-label">BALANCED TEAM MAP</div>
          <div className="squad-map">
            {teams.map((size, index) => (
              <div className="squad-row" key={index}>
                <div className="squad-name">
                  <span>TEAM</span>
                  <strong>{teamName(index)}</strong>
                </div>
                <div className="operators">
                  {Array.from({ length: 6 }, (_, playerIndex) => (
                    <span
                      key={playerIndex}
                      className={playerIndex < size ? 'operator active' : 'operator'}
                    >
                      <UserRound size={15} />
                    </span>
                  ))}
                </div>
                <span className="squad-count">{size}/6</span>
              </div>
            ))}
          </div>

          <div className="rotation-rule">
            <Users size={18} />
            <div>
              <strong>TEAM BALANCE</strong>
              <span>
                {summary.teamCount} balanced teams // {summary.teamSizes.join(' / ')} players. Team sizes differ by no more than one player.
              </span>
            </div>
          </div>

          <div className="rotation-rule">
            <RotateCcw size={18} />
            <div>
              <strong>MATCH ROTATION</strong>
              <span>{matchRotation}</span>
            </div>
          </div>

          <div className={`rotation-status ${summary.customQuoteRequired || summary.rotationsRequired ? 'warning' : 'clear'}`}>
            {summary.customQuoteRequired || summary.rotationsRequired ? <RotateCcw size={17} /> : <BadgeCheck size={17} />}
            <div>
              <strong>
                {summary.customQuoteRequired
                  ? 'CUSTOM QUOTE REQUIRED'
                  : summary.rotationsRequired
                    ? 'ROTATIONS REQUIRED'
                    : 'FULL SIMULTANEOUS DEPLOYMENT'}
              </strong>
              <span>
                {summary.customQuoteRequired
                  ? mission.customQuoteMessage || 'Mission Control will configure the format and price for this group size.'
                  : summary.rotationsRequired
                    ? summary.rotationExtensionMinutes
                      ? `Mission extended by ${formatDuration(summary.rotationExtensionMinutes)}.`
                      : 'Planned rotations stay within the purchased play window.'
                    : 'Your group fits within the 12-player active capacity.'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <MissionMetrics summary={summary} mission={mission} />
      <NavActions onBack={onBack} onNext={onNext} nextLabel="SET DEPLOYMENT" />
    </section>
  );
}

function DeploymentStep({
  draft,
  updateDraft,
  dates,
  mission,
  summary,
  onBack,
  onNext,
  canContinue
}: {
  draft: BookingDraft;
  updateDraft: <K extends keyof BookingDraft>(key: K, value: BookingDraft[K]) => void;
  dates: ReturnType<typeof buildDateChoices>;
  mission: MissionPackage;
  summary: ReturnType<typeof calculateBookingSummary>;
  onBack: () => void;
  onNext: () => void;
  canContinue: boolean;
}) {
  return (
    <section className="panel-stack">
      <StageHeading
        number="03"
        eyebrow="DEPLOYMENT WINDOW"
        title="CHOOSE DATE & LOCATION."
        text="Choose a fixed start window, then tell us where the mobile arena needs to deploy."
      />

      <div className="hud-panel section-block">
        <div className="panel-label">SELECT DATE</div>
        <div className="date-grid">
          {dates.map((date) => (
            <button
              key={date.value}
              type="button"
              className={draft.date === date.value ? 'date-tile active' : 'date-tile'}
              onClick={() => {
                updateDraft('date', date.value);
                updateDraft('time', '');
              }}
            >
              <span>{date.weekday}</span>
              <strong>{date.day}</strong>
              <small>{date.month}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="hud-panel section-block">
        <div className="panel-heading-row">
          <div className="panel-label">SELECT START TIME</div>
          <span className="panel-hint">Last mission may begin at 4:00 PM</span>
        </div>
        <div className="time-grid">
          {fixedStartTimes.map((time) => {
            const unavailable = false;
            return (
              <button
                key={time}
                type="button"
                disabled={!draft.date || unavailable}
                className={draft.time === time ? 'time-slot active' : 'time-slot'}
                onClick={() => updateDraft('time', time)}
              >
                <span>{formatTime(time)}</span>
                <small>PREFERRED TIME</small>
              </button>
            );
          })}
        </div>
        <p className="demo-note">
          All times are Saint Lucia time (AST, UTC−4). This is a preferred time only; availability is not confirmed.
        </p>
      </div>

      <div className="two-column-layout">
        <div className="hud-panel section-block">
          <div className="panel-label">VENUE TYPE</div>
          <div className="venue-grid">
            {venueTypes.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={draft.venueType === id ? 'venue-card active' : 'venue-card'}
                onClick={() => updateDraft('venueType', id)}
              >
                <Icon size={17} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hud-panel section-block form-stack">
          <div className="panel-label">DEPLOYMENT COORDINATES</div>
          <label>
            <span>Town / Area</span>
            <input
              maxLength={100}
              value={draft.area}
              onChange={(event) => updateDraft('area', event.target.value)}
              placeholder="e.g. Gros Islet, Castries, Soufrière"
            />
          </label>
          <label>
            <span>Venue / Address</span>
            <input
              maxLength={500}
              value={draft.address}
              onChange={(event) => updateDraft('address', event.target.value)}
              placeholder="Venue name, street, landmark or directions"
            />
          </label>
          <div className="island-service">
            <MapPin size={16} />
            <div>
              <strong>ISLAND-WIDE SERVICE AREA</strong>
              <span>Gros Islet and Castries are the core service area. A travel surcharge of EC$75–EC$200 may apply elsewhere, depending on location; venue suitability is confirmed by our team.</span>
            </div>
          </div>
        </div>
      </div>

      <div className="hud-panel weather-panel">
        <CloudRain size={24} />
        <div className="weather-copy">
          <div className="panel-label">WEATHER PROTOCOL</div>
          <strong>LIGHT RAIN FLEXIBILITY</strong>
          <p>
            Outdoor missions may continue in light rain when the operator determines conditions are safe.
          </p>
        </div>
        <label className="tactical-checkbox">
          <input
            type="checkbox"
            checked={draft.weatherFlexible}
            onChange={(event) => updateDraft('weatherFlexible', event.target.checked)}
          />
          <span className="checkbox-box"><Check size={14} /></span>
          <span>I am okay playing in light rain if conditions remain safe.</span>
        </label>
      </div>

      <div className="hud-panel section-block form-stack">
        <div className="panel-label">MISSION NOTES — OPTIONAL</div>
        <textarea
          aria-label="Mission notes"
          maxLength={2000}
          rows={3}
          value={draft.notes}
          onChange={(event) => updateDraft('notes', event.target.value)}
          placeholder="Birthday name, special setup instructions, access notes, accessibility needs, event details…"
        />
      </div>

      <MissionMetrics summary={summary} mission={mission} compact />
      <NavActions
        onBack={onBack}
        onNext={onNext}
        nextLabel="OPERATOR DETAILS"
        disabled={!canContinue}
      />
    </section>
  );
}

function EventDetailsStep({
  draft,
  setDraft,
  onBack,
  onNext,
  canContinue
}: {
  draft: BookingDraft;
  setDraft: React.Dispatch<React.SetStateAction<BookingDraft>>;
  onBack: () => void;
  onNext: () => void;
  canContinue: boolean;
}) {
  const update = <K extends keyof BookingDraft['eventDetails']>(
    key: K,
    value: BookingDraft['eventDetails'][K]
  ) => setDraft((current) => ({
    ...current,
    eventDetails: { ...current.eventDetails, [key]: value }
  }));

  return (
    <section className="panel-stack narrow-panel">
      <StageHeading
        number="04"
        eyebrow="PRE-MISSION REGISTRATION"
        title="TELL US ABOUT THE GROUP."
        text="Capture the information we need to prepare the event. Participant names can be added now or completed later using the private registration link."
      />
      <div className="hud-panel account-form">
        <label>
          <span>Event / Group Name</span>
          <input maxLength={120} value={draft.eventDetails.eventName}
            onChange={(event) => update('eventName', event.target.value)}
            placeholder="e.g. Finance Team Challenge or Maya's Birthday" />
        </label>
        <label>
          <span>Company / School / Organization</span>
          <input maxLength={120} value={draft.eventDetails.organization}
            onChange={(event) => update('organization', event.target.value)}
            placeholder="Optional" />
        </label>
        <label>
          <span>Group Type</span>
          <select value={draft.eventDetails.groupType}
            onChange={(event) => update('groupType', event.target.value as BookingDraft['eventDetails']['groupType'])}>
            <option value="birthday">Birthday / private party</option>
            <option value="corporate">Corporate / team building</option>
            <option value="school">School / youth group</option>
            <option value="community">Community / festival</option>
            <option value="resort">Hotel / resort</option>
            <option value="friends">Friends / social group</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          <span>Age Group</span>
          <select value={draft.eventDetails.ageGroup}
            onChange={(event) => update('ageGroup', event.target.value as BookingDraft['eventDetails']['ageGroup'])}>
            <option value="children">Children</option>
            <option value="teens">Teens</option>
            <option value="adults">Adults</option>
            <option value="mixed">Mixed ages</option>
          </select>
        </label>
        <label>
          <span>Emergency Contact Name</span>
          <input required maxLength={120} value={draft.eventDetails.emergencyContactName}
            onChange={(event) => update('emergencyContactName', event.target.value)}
            placeholder="Person available during the event" />
        </label>
        <label>
          <span>Emergency Contact Phone</span>
          <input required type="tel" maxLength={30} value={draft.eventDetails.emergencyContactPhone}
            onChange={(event) => update('emergencyContactPhone', event.target.value)}
            placeholder="+1 758 ..." />
        </label>
        <label>
          <span>Event Goals / Preferences</span>
          <textarea rows={3} maxLength={1000} value={draft.eventDetails.objectives}
            onChange={(event) => update('objectives', event.target.value)}
            placeholder="Team building goals, birthday preferences, competitive level, special requests…" />
        </label>
        <label>
          <span>Accessibility / Setup Notes</span>
          <textarea rows={3} maxLength={1000} value={draft.eventDetails.accessibilityNotes}
            onChange={(event) => update('accessibilityNotes', event.target.value)}
            placeholder="Mobility considerations, venue access, sensory considerations, or other useful preparation notes." />
        </label>
        <label>
          <span>Participant Names — Optional, one per line</span>
          <textarea rows={6} value={draft.eventDetails.participantNames.join('\n')}
            onChange={(event) => update('participantNames',
              event.target.value.split('\n').map((name) => name.trim()).filter(Boolean).slice(0, draft.players))}
            placeholder="Add names now to pre-build the roster. You can finish this later from the registration portal." />
          <small>{draft.eventDetails.participantNames.length} of {draft.players} expected players pre-registered</small>
        </label>
        <label className="tactical-checkbox inline-check">
          <input type="checkbox" checked={draft.eventDetails.photoConsent}
            onChange={(event) => update('photoConsent', event.target.checked)} />
          <span className="checkbox-box"><Check size={14} /></span>
          <span>Organizer is open to event photography/media. Final participant consent is still handled individually where required.</span>
        </label>
      </div>
      <NavActions onBack={onBack} onNext={onNext} nextLabel="OPERATOR DETAILS" disabled={!canContinue} />
    </section>
  );
}

function AccountStep({
  draft,
  setDraft,
  onBack,
  onNext,
  canContinue
}: {
  draft: BookingDraft;
  setDraft: React.Dispatch<React.SetStateAction<BookingDraft>>;
  onBack: () => void;
  onNext: () => void;
  canContinue: boolean;
}) {
  const updateCustomer = (key: keyof BookingDraft['customer'], value: string | boolean) => {
    setDraft((current) => ({
      ...current,
      customer: {
        ...current.customer,
        [key]: value
      }
    }));
  };

  return (
    <section className="panel-stack narrow-panel">
      <StageHeading
        number="05"
        eyebrow="OPERATOR PROFILE"
        title="YOUR CONTACT DETAILS."
        text="Enter the contact details our team should use to arrange your booking. No customer account is created."
      />

      <form
        className="hud-panel account-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (canContinue) onNext();
        }}
      >
        <div className="account-banner">
          <ShieldCheck size={24} />
          <div>
            <strong>CONTACT DETAILS</strong>
            <span>When you submit your request, your details are stored securely for our team to manage the booking and contact you. Marketing is optional.</span>
          </div>
        </div>

        <label>
          <span><UserRound size={14} /> Full Name</span>
          <input
            value={draft.customer.fullName}
            onChange={(event) => updateCustomer('fullName', event.target.value)}
            required
            maxLength={120}
            autoComplete="name"
            placeholder="Mission operator name"
          />
        </label>

        <label>
          <span><Mail size={14} /> Email</span>
          <input
            type="email"
            value={draft.customer.email}
            onChange={(event) => updateCustomer('email', event.target.value)}
            required
            maxLength={254}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>

        <label>
          <span><Phone size={14} /> Phone / WhatsApp</span>
          <input
            type="tel"
            value={draft.customer.phone}
            onChange={(event) => updateCustomer('phone', event.target.value)}
            required
            maxLength={30}
            autoComplete="tel"
            placeholder="+1 758 ..."
          />
        </label>

        <label className="tactical-checkbox inline-check">
          <input
            type="checkbox"
            checked={draft.customer.marketingOptIn}
            onChange={(event) => updateCustomer('marketingOptIn', event.target.checked)}
          />
          <span className="checkbox-box"><Check size={14} /></span>
          <span>Send me mission drops, loyalty rewards, and special-event offers.</span>
        </label>
      </form>

      <NavActions
        onBack={onBack}
        onNext={onNext}
        nextLabel="REVIEW MISSION"
        disabled={!canContinue}
      />
    </section>
  );
}

function ReviewStep({
  mission,
  draft,
  summary,
  onBack,
  onFinalize,
  submitting
}: {
  mission: MissionPackage;
  draft: BookingDraft;
  summary: ReturnType<typeof calculateBookingSummary>;
  onBack: () => void;
  onFinalize: () => void;
  submitting: boolean;
}) {
  const venueLabel = venueTypes.find((item) => item.id === draft.venueType)?.label || draft.venueType;

  return (
    <section className="panel-stack">
      <StageHeading
        number="06"
        eyebrow="MISSION BRIEF"
        title="CONFIRM THE OPERATION."
        text={
          mission.bookingMode === 'instant'
            ? 'Review your request before sending it to Mission Control. Standard package pricing is shown; the team will confirm availability, travel charges and any venue-specific requirements.'
            : 'Review your request. Corporate and resort operations require a final quotation and confirmation from our team.'
        }
      />

      <div className="review-layout">
        <div className="mission-brief">
          <div className="brief-header">
            <div>
              <span>MISSION FILE</span>
              <strong>{mission.callSign}</strong>
            </div>
            <Crosshair size={35} />
          </div>

          <div className="brief-title">
            <small>SELECTED OPERATION</small>
            <h2>{mission.name}</h2>
          </div>

          <BriefRow
            label="Teams"
            value={`${draft.players} players // ${summary.teamCount} balanced teams // ${summary.teamSizes.join(' / ')}`}
          />
          <BriefRow label="Date" value={draft.date} />
          <BriefRow label="Start" value={formatTime(draft.time)} />
          <BriefRow label="Mission time" value={formatDuration(summary.totalMissionMinutes)} />
          <BriefRow label="Scheduling buffer" value={`${formatDuration(summary.operationalBufferMinutes)} // setup & turnaround, not play time`} />
          <BriefRow label="Deployment" value={`${venueLabel} // ${draft.area}`} />
          <BriefRow label="Weather" value={draft.weatherFlexible ? 'Light-rain flexible' : 'Dry-weather preference'} />
          <BriefRow label="Event" value={draft.eventDetails.eventName || mission.name} />
          {draft.eventDetails.organization && <BriefRow label="Organization" value={draft.eventDetails.organization} />}
          <BriefRow label="Age group" value={draft.eventDetails.ageGroup} />
          <BriefRow label="Pre-registered" value={`${draft.eventDetails.participantNames.length} / ${draft.players} players`} />
          <BriefRow label="Emergency contact" value={`${draft.eventDetails.emergencyContactName} // ${draft.eventDetails.emergencyContactPhone}`} />
          <BriefRow label="Operator" value={draft.customer.fullName} />
          {!summary.customQuoteRequired && summary.additionalPlayerPrice > 0 && (
            <BriefRow label="Additional players" value={money(summary.additionalPlayerPrice, summary.currency)} />
          )}
          {!summary.customQuoteRequired && summary.activationFee > 0 && (
            <BriefRow label="Activation fee" value={money(summary.activationFee, summary.currency)} />
          )}
          {!summary.customQuoteRequired && summary.minimumAdjustment > 0 && (
            <BriefRow label="Minimum booking adjustment" value={money(summary.minimumAdjustment, summary.currency)} />
          )}
          {!summary.customQuoteRequired && summary.depositPercent > 0 && (
            <BriefRow label={`Deposit (${summary.depositPercent}%)`} value={money(summary.depositAmount, summary.currency)} />
          )}
          <BriefRow label="Travel fee" value="EC$75–EC$200 may apply outside Gros Islet/Castries" />

          {summary.customQuoteRequired && (
            <div className="brief-alert">
              <ShieldCheck size={16} />
              {mission.customQuoteMessage || 'This group size requires a custom quotation before the booking can be confirmed.'}
            </div>
          )}

          {!summary.customQuoteRequired && summary.privateDeploymentMinimumApplied && (
            <div className="brief-alert">
              <ShieldCheck size={16} />
              The EC$450 private mobile deployment minimum applies to this booking.
            </div>
          )}

          {!summary.customQuoteRequired && summary.rotationsRequired && (
            <div className="brief-alert">
              <RotateCcw size={16} />
              {summary.rotationExtensionMinutes
                ? `Team rotations add ${formatDuration(summary.rotationExtensionMinutes)} to this mission.`
                : 'Planned team rotations are included in this package.'}
            </div>
          )}

          <div className="brief-total">
            <span>
              {summary.customQuoteRequired
                ? 'PRICING STATUS'
                : mission.bookingMode === 'instant'
                  ? 'ESTIMATED TOTAL'
                  : 'WORKING ESTIMATE'}
            </span>
            <strong>
              {summary.customQuoteRequired ? 'CUSTOM QUOTE' : money(summary.totalPrice, summary.currency)}
            </strong>
            {(summary.customQuoteRequired || mission.bookingMode === 'request') && (
              <small>
                {summary.customQuoteRequired
                  ? 'Mission Control will confirm the format, timing and final price.'
                  : 'Final scope confirmed by Mission Control.'}
              </small>
            )}
          </div>
        </div>

        <div className="hud-panel checkout-panel">
          {mission.bookingMode === 'instant' ? (
            <>
              <div className="checkout-icon"><CreditCard size={28} /></div>
              <div className="panel-label">BOOKING REQUEST</div>
              <h3>SEND YOUR MISSION</h3>
              <p>
                Submit your request for our team to review. This does not reserve a slot or charge you.
              </p>
              <div className="payment-total">
                <span>{summary.customQuoteRequired ? 'PRICING STATUS' : 'ESTIMATED TOTAL'}</span>
                <strong>{summary.customQuoteRequired ? 'CUSTOM QUOTE' : money(summary.totalPrice, summary.currency)}</strong>
              </div>
              <button
                type="button"
                className="primary-action payment-action"
                onClick={onFinalize}
                disabled={submitting}
              >
                <WalletCards size={18} />
                {submitting ? 'SENDING…' : summary.customQuoteRequired ? 'SUBMIT QUOTE REQUEST' : 'SUBMIT BOOKING REQUEST'}
              </button>
              <small className="prototype-warning">
                No payment is taken online. {summary.customQuoteRequired
                  ? 'This group size must be quoted before any deposit is requested.'
                  : summary.depositPercent > 0
                    ? `Once confirmed, the booking deposit is ${summary.depositPercent}% (${money(summary.depositAmount, summary.currency)}).`
                    : 'We will contact you to confirm your booking.'}
              </small>
            </>
          ) : (
            <>
              <div className="checkout-icon"><ShieldCheck size={28} /></div>
              <div className="panel-label">CUSTOM OPERATION</div>
              <h3>SEND YOUR REQUEST</h3>
              <p>
                Corporate and resort deployments need a final operational review before payment and confirmation.
              </p>
              <div className="payment-total">
                <span>{summary.customQuoteRequired ? 'PRICING STATUS' : 'WORKING ESTIMATE'}</span>
                <strong>{summary.customQuoteRequired ? 'CUSTOM QUOTE' : money(summary.totalPrice, summary.currency)}</strong>
              </div>
              {!summary.customQuoteRequired && summary.depositPercent > 0 && (
                <small className="prototype-warning">
                  Once the scope is confirmed, the booking deposit is {summary.depositPercent}% ({money(summary.depositAmount, summary.currency)}).
                </small>
              )}
              <button
                type="button"
                className="primary-action payment-action"
                onClick={onFinalize}
                disabled={submitting}
              >
                <Radar size={18} />
                {submitting ? 'SENDING…' : summary.customQuoteRequired ? 'SUBMIT QUOTE REQUEST' : 'SUBMIT BOOKING REQUEST'}
              </button>
            </>
          )}
        </div>
      </div>

      <NavActions onBack={onBack} hideNext disabled={submitting} />
    </section>
  );
}

function StageHeading({
  number,
  eyebrow,
  title,
  text
}: {
  number: string;
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="stage-heading">
      <div className="stage-number">{number}</div>
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}

function MissionMetrics({
  summary,
  mission,
  compact = false
}: {
  summary: ReturnType<typeof calculateBookingSummary>;
  mission: MissionPackage;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'mission-metrics compact' : 'mission-metrics'}>
      <div>
        <span>BASE MISSION</span>
        <strong>{formatDuration(summary.baseDurationMinutes)}</strong>
      </div>
      <div>
        <span>ROTATION EXTENSION</span>
        <strong>{summary.rotationExtensionMinutes ? `+${formatDuration(summary.rotationExtensionMinutes)}` : 'NONE'}</strong>
      </div>
      <div>
        <span>SCHEDULING BUFFER</span>
        <strong>+{formatDuration(summary.operationalBufferMinutes)}</strong>
      </div>
      <div>
        <span>
          {summary.customQuoteRequired
            ? 'PRICING STATUS'
            : mission.bookingMode === 'request'
              ? 'WORKING ESTIMATE'
              : 'ESTIMATED TOTAL'}
        </span>
        <strong>{summary.customQuoteRequired ? 'CUSTOM QUOTE' : money(summary.totalPrice, summary.currency)}</strong>
      </div>
    </div>
  );
}

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="brief-row">
      <span>{label}</span>
      <strong>{value || '—'}</strong>
    </div>
  );
}

function NavActions({
  onBack,
  onNext,
  nextLabel,
  disabled = false,
  hideNext = false
}: {
  onBack: () => void;
  onNext?: () => void;
  nextLabel?: string;
  disabled?: boolean;
  hideNext?: boolean;
}) {
  return (
    <div className="nav-actions">
      <button type="button" className="secondary-action" onClick={onBack} disabled={hideNext && disabled}>
        <ChevronLeft size={16} />
        BACK
      </button>

      {!hideNext && onNext && (
        <button type="button" className="primary-action" onClick={onNext} disabled={disabled}>
          {nextLabel || 'CONTINUE'}
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}

export default App;
