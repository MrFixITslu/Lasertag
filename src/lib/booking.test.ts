import { describe, expect, it } from 'vitest';
import { calculateBookingSummary } from './booking';
import type { MissionPackage } from '../types';

const mission: MissionPackage = {
  id: 'test',
  name: 'Test Mission',
  callSign: 'TEST',
  category: 'public',
  bookingMode: 'instant',
  pricingMode: 'per_participant',
  price: 30,
  currency: 'XCD',
  durationMinutes: 60,
  minPlayers: 6,
  maxConcurrentPlayers: 12,
  description: 'Test',
  highlights: []
};

describe('calculateBookingSummary', () => {
  it('keeps a 12-player group within the base mission duration', () => {
    const result = calculateBookingSummary(mission, 12);

    expect(result.squadCount).toBe(2);
    expect(result.rotationsRequired).toBe(false);
    expect(result.rotationExtensionMinutes).toBe(0);
    expect(result.totalMissionMinutes).toBe(60);
    expect(result.totalBlockMinutes).toBe(120);
    expect(result.totalPrice).toBe(360);
  });

  it('adds 30 minutes for each started group of six above 12 players', () => {
    expect(calculateBookingSummary(mission, 13).rotationExtensionMinutes).toBe(30);
    expect(calculateBookingSummary(mission, 18).rotationExtensionMinutes).toBe(30);
    expect(calculateBookingSummary(mission, 19).rotationExtensionMinutes).toBe(60);
    expect(calculateBookingSummary(mission, 24).rotationExtensionMinutes).toBe(60);
  });

  it('enforces the six-player minimum for calculations', () => {
    const result = calculateBookingSummary(mission, 2);

    expect(result.squadCount).toBe(1);
    expect(result.totalPrice).toBe(180);
  });

  it('does not multiply fixed-price missions by player count', () => {
    const fixedMission = { ...mission, pricingMode: 'fixed' as const, price: 650 };
    const result = calculateBookingSummary(fixedMission, 18);

    expect(result.totalPrice).toBe(650);
    expect(result.totalMissionMinutes).toBe(90);
  });
});
