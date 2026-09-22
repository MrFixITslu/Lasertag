import Brand from './Brand';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, Crosshair, MapPin, Pause, Play, Radio, Shield, Target, Users, X, Zap } from 'lucide-react';
import { missions } from './data/missions';
import { formatDuration } from './lib/booking';
import './landing.css';

const gameplayId = 'JPc3ajSWqJA';
const slogans = ['OUTTHINK. OUTFLANK. OUTPLAY.', 'YOUR SQUAD. YOUR STRATEGY.', 'BRAGGING RIGHTS START HERE.'];
const operations = [
  { id: 'birthday-strike', title: 'BIRTHDAY STRIKE', label: 'Birthday squads', brief: 'One birthday. Two sides. A whole lot of friendly rivalry. Rally your favourite people for a party with a mission.', objective: 'Make their birthday legendary.', icon: Target },
  { id: 'community-festival-play', title: 'COMMUNITY OPS', label: 'Festivals & communities', brief: 'Turn the gathering into the main event. Short, action-packed rounds bring your community together, one squad at a time.', objective: 'Bring the whole community into play.', icon: MapPin },
  { id: 'corporate-team-battle', title: 'TEAM DEPLOYMENT', label: 'Corporate teams', brief: 'Trade the meeting room for a mission. Think on your feet, work together and discover a different side of your team.', objective: 'Build a team beyond the office.', icon: Shield },
  { id: 'resort-guest-experience', title: 'ISLAND ESCAPE', label: 'Hotels & resorts', brief: 'Give your guests a new island story. A mobile laser tag experience brings friendly competition to their stay.', objective: 'Make the holiday a shared adventure.', icon: Zap }
];

export default function Landing() {
  const [motion, setMotion] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [line, setLine] = useState(0);
  const [operation, setOperation] = useState(0);
  const [theatre, setTheatre] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const selected = operations[operation];
  const mission = missions.find(item => item.id === selected.id)!;

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotion(!preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!motion || theatre) return;
    const timer = window.setInterval(() => setLine(current => (current + 1) % slogans.length), 4600);
    return () => window.clearInterval(timer);
  }, [motion, theatre]);
  useEffect(() => {
    if (theatre) {
      dialog.current?.showModal();
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = previousOverflow; };
    }
    dialog.current?.close();
  }, [theatre]);
  function closeTheatre() { dialog.current?.close(); setTheatre(false); }

  return (
    <div className={`cz-landing ${motion ? '' : 'cz-still'}`}>
      <a href="#operations" className="cz-skip">Skip to mission briefs</a>
      <section className="cz-hero" aria-labelledby="landing-title">
        <div className="cz-media" aria-hidden="true">
          {motion && !theatre && <iframe title="NETRONIC FALCON outdoor gameplay background" src={`https://www.youtube-nocookie.com/embed/${gameplayId}?autoplay=1&mute=1&loop=1&playlist=${gameplayId}&controls=0&playsinline=1&rel=0`} allow="autoplay; encrypted-media" tabIndex={-1} referrerPolicy="strict-origin-when-cross-origin" />}
        </div>
        <div className="cz-shade" aria-hidden="true" />
        <div className="cz-grain" aria-hidden="true" />
        <header className="cz-nav">
          <Brand />
          <nav aria-label="Main navigation"><a href="#operations">THE MISSIONS</a><a href="#field-kit">THE EXPERIENCE</a></nav>
          <a href="#booking" className="cz-nav-cta">ENTER THE ZONE <ArrowUpRight size={16} /></a>
        </header>
        <div className="cz-hero-layout">
          <div className="cz-hero-copy">
            <p className="cz-kicker"><span className="cz-dot" /> SAINT LUCIA. THIS IS YOUR PLAYGROUND.</p>
            <h1 id="landing-title"><span>REAL WORLD.</span><span className="cz-outline">GAME ON.</span></h1>
            <div className="cz-slogan" aria-label={slogans.join(' ')}><p key={line} aria-hidden="true">{slogans[line]}</p></div>
            <p className="cz-intro">Leave ordinary behind. Bring your squad into a mobile laser tag battle built for big moves, close calls and unforgettable wins.</p>
            <div className="cz-hero-actions"><a href="#booking" className="cz-enter"><Crosshair size={21} /><span>ENTER THE COMBATZONE<small>YOUR NEXT MISSION STARTS HERE</small></span><ArrowUpRight size={25} /></a><button className="cz-watch" onClick={() => setTheatre(true)}><span><Play size={18} fill="currentColor" /></span>WATCH THE ACTION</button></div>
            <p className="cz-preview">Explore mission packages · Online reservations coming soon</p>
          </div>
          <aside className="cz-target-display" aria-label="Mobile laser tag in Saint Lucia">
            <div className="cz-target-top"><span><Radio size={14} /> FIELD INTEL</span><span>LC / 001</span></div>
            <div className="cz-reticle" aria-hidden="true"><div className="cz-ring" /><div className="cz-ring cz-inner-ring" /><Crosshair size={42} /><span className="cz-blip cz-blip-one" /><span className="cz-blip cz-blip-two" /><span className="cz-reticle-label">MISSION AREA</span></div>
            <div className="cz-target-title">ONE ISLAND.<br /><b>ENDLESS GAME.</b></div>
            <div className="cz-target-bottom"><MapPin size={14} /><span>WE BRING THE BATTLE TO YOU.</span></div>
          </aside>
        </div>
        <div className="cz-hero-bottom"><a href="#operations"><ArrowDown size={16} /> SCROLL TO YOUR MISSION</a><span>FALCON GAMEPLAY / NETRONIC</span><button onClick={() => setMotion(!motion)} aria-pressed={!motion}>{motion ? <Pause size={14} /> : <Play size={14} />}{motion ? 'PAUSE MOTION' : 'RESUME MOTION'}</button></div>
      </section>
      <div className="cz-field-strip"><span><Crosshair /> TACTICAL PLAY</span><span><Users /> REAL CONNECTION</span><span><MapPin /> MOBILE DEPLOYMENT</span><span><Zap /> PURE ADRENALINE</span></div>
      <main>
        <section id="operations" className="cz-operations" aria-labelledby="operations-title">
          <div className="cz-section-head"><div><p className="cz-kicker">01 / CHOOSE YOUR OPERATION</p><h2 id="operations-title">Every squad<br />has a <em>mission.</em></h2></div><p>A birthday to remember. A team to bring together. A community ready to play. Pick your occasion. We’ll bring the action.</p></div>
          <div className="cz-mission-console">
            <div className="cz-mission-select" role="group" aria-label="Choose an occasion">{operations.map((item, index) => <button key={item.id} onClick={() => setOperation(index)} aria-pressed={operation === index} aria-controls="mission-brief"><span className="cz-mission-number">0{index + 1}</span><span><strong>{item.title}</strong><small>{item.label}</small></span><ArrowUpRight size={20} /></button>)}</div>
            <div id="mission-brief" className="cz-mission-brief" aria-live="polite">
              <div key={operation} className="cz-brief-content"><p className="cz-kicker">MISSION DOSSIER / {mission.callSign}</p><selected.icon className="cz-brief-icon" size={100} aria-hidden="true" /><h3>{selected.title}</h3><p>{selected.brief}</p><div className="cz-objective"><span>YOUR OBJECTIVE</span><strong>{selected.objective}</strong></div><div className="cz-brief-facts"><span>BASE PLAY TIME<strong>{formatDuration(mission.durationMinutes)}</strong></span><span>MINIMUM SQUAD<strong>{mission.minPlayers} players</strong></span><a href="#booking">EXPLORE PACKAGES <ArrowUpRight size={20} /></a></div><small className="cz-provisional">Package timings are provisional; final arrangements require confirmation.</small></div>
            </div>
          </div>
        </section>
        <section id="field-kit" className="cz-kit" aria-labelledby="kit-title">
          <div className="cz-kit-image"><img src="/media/netronic-falcon.webp" alt="NETRONIC Falcon laser tag equipment" loading="lazy" width="900" height="600" /><span className="cz-kit-stamp">FIELD KIT / FALCON</span><span className="cz-kit-caption">EQUIPMENT IMAGE: NETRONIC</span></div>
          <div className="cz-kit-copy"><p className="cz-kicker">02 / GET IN THE GAME</p><h2 id="kit-title">The screen is off.<br />The <em>battle is on.</em></h2><p>Take the energy of your favourite team game into the real world. Move together. Find your angle. Make the next play count.</p><ol><li><span>01</span><div><strong>RALLY YOUR SQUAD</strong><p>Get your people together and explore your mission.</p></div></li><li><span>02</span><div><strong>CHOOSE YOUR GROUND</strong><p>Tell us where in Saint Lucia you want to play. The location must be suitable for the setup.</p></div></li><li><span>03</span><div><strong>MAKE YOUR MOVE</strong><p>Gear up, follow the briefing and let friendly rivalry take over.</p></div></li></ol><button className="cz-text-button" onClick={() => setTheatre(true)}>SEE FALCON IN ACTION <Play size={16} /></button></div>
        </section>
        <section className="cz-final" aria-labelledby="final-title"><div className="cz-final-grid" aria-hidden="true" /><Crosshair size={36} /><p className="cz-kicker">SQUAD INVITE / YOU’RE IN</p><h2 id="final-title">LESS “SOMEDAY”.<br /><em>MORE GAME DAY.</em></h2><p>The group chat has talked enough. Give it a mission.</p><a href="#booking" className="cz-enter">ENTER THE COMBATZONE <ArrowUpRight size={23} /></a></section>
      </main>
      <footer className="cz-footer"><span>COMBATZONE SLU <small>MOBILE LASER TAG / SAINT LUCIA</small></span><a href="https://netronic.net/en/media" target="_blank" rel="noreferrer">Equipment imagery & illustrative gameplay: NETRONIC</a><a href="#booking">MISSION BOOKING <ArrowUpRight size={14} /></a></footer>
      <dialog ref={dialog} className="cz-theatre" aria-labelledby="theatre-title" onCancel={closeTheatre} onClose={() => setTheatre(false)}>
        <header><div><small>COMBATZONE SLU / FIELD FOOTAGE</small><h2 id="theatre-title">FALCON. IN ACTION.</h2></div><button onClick={closeTheatre} aria-label="Close gameplay video"><X /></button></header>
        {theatre && <iframe title="Watch NETRONIC Falcon outdoor laser tag gameplay" src={`https://www.youtube-nocookie.com/embed/${gameplayId}?autoplay=1&rel=0&playsinline=1`} allow="autoplay; encrypted-media; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />}
        <p>Illustrative gameplay by NETRONIC. <a href={`https://www.youtube.com/watch?v=${gameplayId}`} target="_blank" rel="noreferrer">Watch on YouTube <ArrowUpRight size={13} /></a></p>
      </dialog>
    </div>
  );
}
