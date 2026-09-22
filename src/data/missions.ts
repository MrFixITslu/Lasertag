import type { MissionPackage } from '../types';

/**
 * Commercial package configuration.
 *
 * Prices reflect the current working package set.
 * Durations are intentionally centralized here because final package timing
 * should be confirmed against the approved commercial package sheet before launch.
 */
export const missions: MissionPackage[] = [
  {
    id: 'quick-battle',
    name: 'Quick Battle',
    callSign: 'RAPID-30',
    category: 'public',
    bookingMode: 'instant',
    pricingMode: 'per_participant',
    price: 30,
    currency: 'XCD',
    durationMinutes: 30,
    minPlayers: 6,
    maxConcurrentPlayers: 12,
    description: 'Fast deployment for squads that want the action without a long operation.',
    highlights: ['Fast mission', '6+ players', 'Mobile setup']
  },
  {
    id: 'battle-hour',
    name: 'Battle Hour',
    callSign: 'HOUR-60',
    category: 'public',
    bookingMode: 'instant',
    pricingMode: 'per_participant',
    price: 50,
    currency: 'XCD',
    durationMinutes: 60,
    minPlayers: 6,
    maxConcurrentPlayers: 12,
    description: 'A full hour of rotating game modes and team battles.',
    highlights: ['60-minute mission', 'Multiple game modes', '6+ players']
  },
  {
    id: 'birthday-strike',
    name: 'Birthday Strike',
    callSign: 'B-DAY-1',
    category: 'birthday',
    bookingMode: 'instant',
    pricingMode: 'fixed',
    price: 450,
    currency: 'XCD',
    durationMinutes: 60,
    minPlayers: 6,
    maxConcurrentPlayers: 12,
    description: 'A focused birthday mission with enough time for a complete team battle experience.',
    highlights: ['Birthday ready', 'Private mission', 'Up to 12 active players']
  },
  {
    id: 'birthday-battle',
    name: 'Birthday Battle',
    callSign: 'B-DAY-2',
    category: 'birthday',
    bookingMode: 'instant',
    pricingMode: 'fixed',
    price: 650,
    currency: 'XCD',
    durationMinutes: 120,
    minPlayers: 6,
    maxConcurrentPlayers: 12,
    description: 'More time, more modes, and more room for squad rotations.',
    highlights: ['Extended play', 'Great for larger groups', 'Private mission']
  },
  {
    id: 'ultimate-birthday-tournament',
    name: 'Ultimate Birthday Tournament',
    callSign: 'B-DAY-X',
    category: 'birthday',
    bookingMode: 'instant',
    pricingMode: 'fixed',
    price: 850,
    currency: 'XCD',
    durationMinutes: 180,
    minPlayers: 6,
    maxConcurrentPlayers: 12,
    description: 'A tournament-style birthday operation built for teams, rotations, and a big finish.',
    highlights: ['Tournament format', 'Longest birthday mission', 'Rotation friendly']
  },
  {
    id: 'community-festival-play',
    name: 'Community / Festival Play',
    callSign: 'FIELD-OPS',
    category: 'community',
    bookingMode: 'instant',
    pricingMode: 'per_participant',
    price: 20,
    currency: 'XCD',
    durationMinutes: 60,
    minPlayers: 6,
    maxConcurrentPlayers: 12,
    description: 'Mobile laser tag for community events, festivals, and open-play activations.',
    highlights: ['Island-wide deployment', 'Per-player pricing', 'Event friendly']
  },
  {
    id: 'corporate-team-battle',
    name: 'Corporate Team Battle',
    callSign: 'TEAM-OPS',
    category: 'corporate',
    bookingMode: 'request',
    pricingMode: 'fixed',
    price: 800,
    currency: 'XCD',
    durationMinutes: 120,
    minPlayers: 6,
    maxConcurrentPlayers: 12,
    description: 'A customizable team-building mission for companies and staff groups.',
    highlights: ['Custom format', 'Team building', 'Request a Mission']
  },
  {
    id: 'corporate-tournament',
    name: 'Corporate Tournament',
    callSign: 'CORP-X',
    category: 'corporate',
    bookingMode: 'request',
    pricingMode: 'fixed',
    price: 1200,
    currency: 'XCD',
    durationMinutes: 180,
    minPlayers: 6,
    maxConcurrentPlayers: 12,
    description: 'A longer tournament operation for larger teams and company events.',
    highlights: ['Tournament structure', 'Custom timing', 'Request a Mission']
  },
  {
    id: 'resort-guest-experience',
    name: 'Resort Guest Experience',
    callSign: 'RESORT-OPS',
    category: 'resort',
    bookingMode: 'request',
    pricingMode: 'per_participant',
    price: 20,
    currency: 'USD',
    durationMinutes: 60,
    minPlayers: 6,
    maxConcurrentPlayers: 12,
    description: 'A tailored guest activity designed for hotel and resort operations.',
    highlights: ['Guest experience', 'Custom deployment', 'Request a Mission']
  }
];

export const directBookMissions = missions.filter((mission) => mission.bookingMode === 'instant');
export const requestMissions = missions.filter((mission) => mission.bookingMode === 'request');
