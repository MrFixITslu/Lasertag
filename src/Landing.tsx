import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, Crosshair, MapPin, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import './landing.css';

// Replace with approved Phantom footage when supplied. Current media is credited NETRONIC footage.
const videoSource = import.meta.env.VITE_HERO_VIDEO_URL || '';
const poster = '/media/netronic-poster.webp';
const gameplayId = 'JPc3ajSWqJA';
const slogans = ['BRING YOUR SQUAD.', 'OWN THE MOMENT.', 'MAKE IT LEGENDARY.'];

export default function Landing() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [motion, setMotion] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [line, setLine] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotion(!preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!motion) { video.current?.pause(); return; }
    const timer = window.setInterval(() => setLine(current => (current + 1) % slogans.length), 4400);
    return () => window.clearInterval(timer);
  }, [motion]);
  async function toggleVideo() {
    if (!video.current) return;
    if (playing) video.current.pause();
    else try { await video.current.play(); } catch { setFailed(true); }
  }
  return (
    <div className={`cz-landing ${motion ? '' : 'cz-still'}`}>
      <a href="#experience" className="cz-skip">Skip to the experience</a>
      <section className="cz-hero" aria-labelledby="landing-title">
        <div className="cz-media" aria-hidden="true" style={{ backgroundImage: `url(${poster})` }}>
          {videoSource && !failed && <video ref={video} src={videoSource} poster={poster} autoPlay={motion} muted={muted} loop playsInline preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setFailed(true)} />}
          {!videoSource && motion && <iframe title="NETRONIC outdoor laser tag gameplay featuring FALCON" src={`https://www.youtube-nocookie.com/embed/${gameplayId}?autoplay=1&mute=1&loop=1&playlist=${gameplayId}&controls=0&playsinline=1&rel=0`} allow="autoplay; encrypted-media" tabIndex={-1} referrerPolicy="strict-origin-when-cross-origin" />}
        </div>
        <div className="cz-shade" aria-hidden="true" />
        <header className="cz-nav">
          <a className="cz-brand" href="#" aria-label="CombatZone SLU home"><Crosshair /><span>COMBATZONE <b>SLU</b><small>SAINT LUCIA · MOBILE LASER TAG</small></span></a>
          <a href="#booking" className="cz-nav-link">PLAN YOUR GAME <ArrowUpRight size={17} /></a>
        </header>
        <div className="cz-hero-content">
          <p className="cz-eyebrow"><span /> YOUR ISLAND. YOUR SQUAD. YOUR GAME.</p>
          <h1 id="landing-title">STEP OUTSIDE.<br /><span>PLAY ALL OUT.</span></h1>
          <div className="cz-slogan" aria-label="Bring your squad. Own the moment. Make it legendary."><p key={line} aria-hidden="true">{slogans[line]}</p></div>
          <p className="cz-intro">Turn your next get-together into a story worth telling. Mobile laser tag brings the action to your corner of Saint Lucia.</p>
          <a href="#booking" className="cz-enter">ENTER THE COMBATZONE <ArrowUpRight /><small>CHOOSE YOUR MISSION →</small></a>
          <p className="cz-preview">Explore packages · Online booking coming soon</p>
        </div>
        <div className="cz-bottom">
          <a href="#experience" className="cz-discover"><ArrowDown size={18} /> THE MISSION STARTS HERE</a>
          <a className="cz-watch" href={`https://www.youtube.com/watch?v=${gameplayId}`} target="_blank" rel="noreferrer"><Play size={14} /> WATCH GAMEPLAY · NETRONIC FALCON</a>
          <div className="cz-media-controls">
            {videoSource && !failed && <><button onClick={toggleVideo} aria-label={playing ? 'Pause background video' : 'Play background video'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><button onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute video' : 'Mute video'}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button></>}
            <button onClick={() => setMotion(!motion)} aria-pressed={!motion}>{motion ? 'PAUSE MOTION' : 'RESUME MOTION'}</button>
          </div>
        </div>
        <span className="cz-coordinate" aria-hidden="true">14° N / 61° W<br />MISSION: GOOD TIMES</span>
      </section>
      <main id="experience" className="cz-experience">
        <div className="cz-section-heading"><p className="cz-eyebrow">LESS SCROLLING. MORE STORIES.</p><h2>Same friends.<br /><span>Whole new game.</span></h2><p>Rally your crew. Pick your occasion. We bring the laser tag experience to a suitable location for your event.</p></div>
        <div className="cz-occasions">
          {[['01', 'BIRTHDAY. UPGRADED.', 'Swap the usual party for team rivalries, big laughs and bragging rights.'], ['02', 'YOUR COMMUNITY. IN PLAY.', 'Bring neighbours and friends together for festival and community fun.'], ['03', 'OUT OF OFFICE. INTO ACTION.', 'Give your team or resort guests something to talk about long after the game.']].map(([number, title, text]) => <a href="#booking" key={number} className="cz-occasion"><span>{number} / MISSION BRIEF <ArrowUpRight size={18} /></span><h3>{title}</h3><p>{text}</p><strong>EXPLORE THE MISSION →</strong></a>)}
        </div>
        <div className="cz-final"><MapPin /><p>ACROSS SAINT LUCIA</p><h2>Your next great story<br />starts with <em>“you in?”</em></h2><a className="cz-enter" href="#booking">LET’S PLAY <ArrowUpRight /></a></div>
      </main>
      <footer className="cz-footer"><span>COMBATZONE SLU · MOBILE LASER TAG</span><a href="https://netronic.net/en/media" target="_blank" rel="noreferrer">Imagery: NETRONIC · Video: NETRONIC FALCON · Illustrative footage</a></footer>
    </div>
  );
}
