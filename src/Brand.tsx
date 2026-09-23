import { Crosshair } from 'lucide-react';

export default function Brand({ className = '', href = '#' }: { className?: string; href?: string }) {
  return (
    <a className={`cz-brand ${className}`} href={href} aria-label="CombatZone SLU — back to home">
      <Crosshair aria-hidden="true" />
      <span>COMBATZONE <b>SLU</b><small>MOBILE LASER TAG / SAINT LUCIA</small></span>
    </a>
  );
}
