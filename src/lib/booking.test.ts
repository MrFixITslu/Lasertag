import { describe, expect, it } from 'vitest';
import {
  calculateBookingSummary,
  buildBalancedTeams,
  buildMatchRotation,
  buildDateChoices,
  validCustomer
} from './booking';
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


describe('balanced team planning', () => {
  it('splits 15 corporate players into three equal teams', () => {
    expect(buildBalancedTeams(15)).toEqual([5, 5, 5]);
    const summary = calculateBookingSummary(
      missions.find((item) => item.id === 'corporate-team-battle')!,
      15
    );
    expect(summary.teamCount).toBe(3);
    expect(summary.squadCount).toBe(3);
    expect(summary.teamSizes).toEqual([5, 5, 5]);
    expect(summary.matchRotation).toHaveLength(3);
  });

  it('balances uneven teams to within one player', () => {
    expect(buildBalancedTeams(7)).toEqual([4, 3]);
    expect(buildBalancedTeams(13)).toEqual([5, 4, 4]);
    expect(buildBalancedTeams(16)).toEqual([6, 5, 5]);
    expect(buildBalancedTeams(17)).toEqual([6, 6, 5]);
    expect(buildBalancedTeams(19)).toEqual([5, 5, 5, 4]);
    expect(buildBalancedTeams(23)).toEqual([6, 6, 6, 5]);
  });

  it('keeps every standard 6-24 player group balanced and at six or fewer per team', () => {
    for (let players = 6; players <= 24; players += 1) {
      const teams = buildBalancedTeams(players);
      expect(teams.reduce((sum, size) => sum + size, 0)).toBe(players);
      expect(Math.max(...teams)).toBeLessThanOrEqual(6);
      expect(Math.max(...teams) - Math.min(...teams)).toBeLessThanOrEqual(1);
      expect(teams.length).toBe(Math.max(2, Math.ceil(players / 6)));
    }
  });

  it('creates each round-robin pairing exactly once', () => {
    const rotation = buildMatchRotation(4);
    expect(rotation).toHaveLength(6);
    const unique = new Set(
      rotation.map(([left, right]) => [left, right].sort((a, b) => a - b).join('-'))
    );
    expect(unique.size).toBe(6);
    expect([...unique].sort()).toEqual(['0-1', '0-2', '0-3', '1-2', '1-3', '2-3']);
  });
});

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

  it('enforces the six-player minimum and still creates two balanced teams', () => {
    const result = calculateBookingSummary(mission, 2);

    expect(result.squadCount).toBe(2);
    expect(result.teamCount).toBe(2);
    expect(result.teamSizes).toEqual([3, 3]);
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

  it('keeps public Quick Battle at per-player pricing with a short turnaround buffer', () => {
    const summary = calculateBookingSummary(packageById('quick-battle'), 6);
    expect(summary.totalPrice).toBe(180);
    expect(summary.depositPercent).toBe(0);
    expect(summary.baseDurationMinutes).toBe(15);
    expect(summary.operationalBufferMinutes).toBe(15);
    expect(summary.totalBlockMinutes).toBe(30);
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
    expect(summary.operationalBufferMinutes).toBe(60);
    expect(summary.totalBlockMinutes).toBe(75);
  });

  it('enforces the Battle Hour minimum without giving larger standard groups free extra time', () => {
    const minimum = calculateBookingSummary(packageById('battle-hour'), 8);
    const larger = calculateBookingSummary(packageById('battle-hour'), 24);
    expect(minimum.totalPrice).toBe(480);
    expect(minimum.operationalBufferMinutes).toBe(30);
    expect(larger.totalMissionMinutes).toBe(60);
    expect(larger.rotationExtensionMinutes).toBe(0);
    expect(larger.customQuoteRequired).toBe(false);
  });

  it('charges birthday extras inside the standard limit and quotes larger groups', () => {
    const summary = calculateBookingSummary(packageById('birthday-strike'), 10);
    const oversized = calculateBookingSummary(packageById('birthday-strike'), 13);
    expect(summary.packagePrice).toBe(550);
    expect(summary.additionalPlayerPrice).toBe(100);
    expect(summary.totalPrice).toBe(650);
    expect(summary.depositAmount).toBe(260);
    expect(summary.totalMissionMinutes).toBe(60);
    expect(oversized.customQuoteRequired).toBe(true);
    expect(oversized.rotationExtensionMinutes).toBe(0);
    expect(oversized.totalMissionMinutes).toBe(60);
    expect(oversized.depositPercent).toBe(0);
  });

  it('prices community activations by 15-minute participant rounds', () => {
    const firstRound = calculateBookingSummary(packageById('community-festival-play'), 6);
    const secondRound = calculateBookingSummary(packageById('community-festival-play'), 24);
    expect(firstRound.packagePrice).toBe(180);
    expect(firstRound.activationFee).toBe(500);
    expect(firstRound.totalPrice).toBe(680);
    expect(firstRound.baseDurationMinutes).toBe(15);
    expect(secondRound.rotationExtensionMinutes).toBe(15);
    expect(secondRound.totalMissionMinutes).toBe(30);
    expect(secondRound.totalPrice).toBe(1220);
  });

  it('includes planned corporate tournament rotations in the purchased three-hour window', () => {
    const summary = calculateBookingSummary(packageById('corporate-tournament'), 24);
    const oversized = calculateBookingSummary(packageById('corporate-tournament'), 25);
    expect(summary.totalPrice).toBe(1500);
    expect(summary.rotationsRequired).toBe(true);
    expect(summary.rotationsIncluded).toBe(true);
    expect(summary.rotationExtensionMinutes).toBe(0);
    expect(summary.totalMissionMinutes).toBe(180);
    expect(summary.depositAmount).toBe(750);
    expect(oversized.customQuoteRequired).toBe(true);
    expect(oversized.depositPercent).toBe(0);
  });

  it('requires custom quotes above School/Youth and Resort standard capacities', () => {
    const school = calculateBookingSummary(packageById('school-youth-battle'), 21);
    const resort = calculateBookingSummary(packageById('resort-guest-experience'), 13);
    expect(school.customQuoteRequired).toBe(true);
    expect(school.totalMissionMinutes).toBe(90);
    expect(school.rotationExtensionMinutes).toBe(0);
    expect(school.depositPercent).toBe(0);
    expect(resort.customQuoteRequired).toBe(true);
    expect(resort.totalMissionMinutes).toBe(90);
    expect(resort.rotationExtensionMinutes).toBe(0);
    expect(resort.depositPercent).toBe(0);
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
