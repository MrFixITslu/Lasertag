import { describe, expect, it } from 'vitest';
import { calculateBookingSummary, buildDateChoices, validCustomer } from './booking';
import type { MissionPackage } from '../types';
import { missions } from '../data/missions';

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



describe('commercial package pricing', () => {
  const packageById = (id: string) => {
    const value = missions.find((item) => item.id === id);
    if (!value) throw new Error(`Missing mission: ${id}`);
    return value;
  };

  it('keeps public Quick Battle at per-player pricing', () => {
    const summary = calculateBookingSummary(packageById('quick-battle'), 6);
    expect(summary.totalPrice).toBe(180);
    expect(summary.depositPercent).toBe(0);
  });

  it('applies the private mobile minimum and deposit to Quick Battle', () => {
    const summary = calculateBookingSummary(packageById('quick-battle'), 6, {
      privateDeployment: true
    });
    expect(summary.totalPrice).toBe(450);
    expect(summary.minimumAdjustment).toBe(270);
    expect(summary.privateDeploymentMinimumApplied).toBe(true);
    expect(summary.depositPercent).toBe(40);
    expect(summary.depositAmount).toBe(180);
  });

  it('enforces the Battle Hour eight-player minimum price', () => {
    expect(calculateBookingSummary(packageById('battle-hour'), 8).totalPrice).toBe(480);
  });

  it('charges birthday extras after included players', () => {
    const summary = calculateBookingSummary(packageById('birthday-strike'), 10);
    expect(summary.packagePrice).toBe(550);
    expect(summary.additionalPlayerPrice).toBe(100);
    expect(summary.totalPrice).toBe(650);
    expect(summary.depositAmount).toBe(260);
  });

  it('adds the community activation fee to player pricing', () => {
    const summary = calculateBookingSummary(packageById('community-festival-play'), 6);
    expect(summary.packagePrice).toBe(180);
    expect(summary.activationFee).toBe(500);
    expect(summary.totalPrice).toBe(680);
  });

  it('includes planned corporate tournament rotations for 24 players', () => {
    const summary = calculateBookingSummary(packageById('corporate-tournament'), 24);
    expect(summary.totalPrice).toBe(1500);
    expect(summary.rotationsRequired).toBe(true);
    expect(summary.rotationsIncluded).toBe(true);
    expect(summary.rotationExtensionMinutes).toBe(0);
    expect(summary.depositAmount).toBe(750);
  });
});

describe('production input boundaries', () => {
  it('uses Saint Lucia calendar dates around UTC midnight and year rollover', () => {
    expect(buildDateChoices(1, new Date('2026-01-01T02:00:00Z'))[0].value).toBe('2026-01-01');
    expect(buildDateChoices(1, new Date('2026-01-01T05:00:00Z'))[0].value).toBe('2026-01-02');
  });
  it('rejects malformed contact details even outside native form submission', () => {
    const customer = { fullName: 'Test Customer', email: 'test@example.com', phone: '+1 758 555 1234', marketingOptIn: false };
    expect(validCustomer(customer)).toBe(true);
    expect(validCustomer({ ...customer, email: 'invalid' })).toBe(false);
    expect(validCustomer({ ...customer, phone: 'abcdefg' })).toBe(false);
  });
  it('keeps calculations finite and bounded', () => {
    expect(calculateBookingSummary(mission, Infinity).totalPrice).toBe(180);
    expect(calculateBookingSummary(mission, NaN).totalPrice).toBe(180);
    expect(calculateBookingSummary(mission, 1000).totalPrice).toBe(1800);
  });
  it('uses configured package minimum and equipment capacity', () => {
    const custom = { ...mission, minPlayers: 10, maxConcurrentPlayers: 18 };
    expect(calculateBookingSummary(custom, 6).totalPrice).toBe(300);
    expect(calculateBookingSummary(custom, 18).rotationExtensionMinutes).toBe(0);
  });
});
