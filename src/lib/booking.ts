import type { BookingSummary, MissionPackage, CustomerProfile } from '../types';

export const MIN_PLAYERS = 6;
export const MAX_CONCURRENT_PLAYERS = 12;
export const ROTATION_GROUP_SIZE = 6;
export const ROTATION_EXTENSION_MINUTES = 30;
export const OPERATIONAL_BUFFER_MINUTES = 60;

export const fixedStartTimes = [
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00'
] as const;

function moneyRound(value: number) {
  return Math.round(value * 100) / 100;
}

export function isPrivateDeploymentVenue(venueType: string) {
  return ['home', 'field', 'other'].includes(venueType);
}

export function calculateBookingSummary(
  mission: MissionPackage,
  players: number,
  options: { privateDeployment?: boolean } = {}
): BookingSummary {
  const normalizedPlayers = Math.min(
    60,
    Math.max(
      mission.minPlayers,
      Math.floor(Number.isFinite(players) ? players : mission.minPlayers)
    )
  );

  const squadCount = Math.ceil(normalizedPlayers / ROTATION_GROUP_SIZE);
  const rotationsRequired = normalizedPlayers > mission.maxConcurrentPlayers;
  const rotationIncludedPlayers = Math.max(
    mission.maxConcurrentPlayers,
    mission.rotationIncludedPlayers ?? mission.maxConcurrentPlayers
  );
  const rotationGroupSize = mission.rotationGroupSize ?? ROTATION_GROUP_SIZE;
  const rotationMinutesPerGroup =
    mission.rotationExtensionMinutes ?? ROTATION_EXTENSION_MINUTES;
  const overflowPlayers = Math.max(0, normalizedPlayers - rotationIncludedPlayers);
  const extraRotationGroups = Math.ceil(overflowPlayers / rotationGroupSize);
  const rotationExtensionMinutes = extraRotationGroups * rotationMinutesPerGroup;
  const rotationsIncluded = rotationsRequired && rotationExtensionMinutes === 0;
  const customQuoteRequired = Boolean(
    mission.standardPricingMaxPlayers &&
      normalizedPlayers > mission.standardPricingMaxPlayers
  );

  let packagePrice = mission.price;
  let additionalPlayerPrice = 0;

  if (mission.pricingMode === 'per_participant') {
    packagePrice = moneyRound(mission.price * normalizedPlayers);
  } else if (mission.includedPlayers && mission.extraPlayerPrice) {
    const extraPlayers = Math.max(0, normalizedPlayers - mission.includedPlayers);
    additionalPlayerPrice = moneyRound(extraPlayers * mission.extraPlayerPrice);
  }

  const subtotalBeforeMinimum = moneyRound(packagePrice + additionalPlayerPrice);
  const privateMinimum =
    options.privateDeployment ? mission.privateDeploymentMinimum ?? 0 : 0;
  const effectiveMinimum = Math.max(mission.minimumCharge ?? 0, privateMinimum);
  const pricedSubtotal = Math.max(subtotalBeforeMinimum, effectiveMinimum);
  const minimumAdjustment = moneyRound(pricedSubtotal - subtotalBeforeMinimum);
  const activationFee = moneyRound(mission.activationFee ?? 0);
  const totalPrice = moneyRound(pricedSubtotal + activationFee);
  const configuredBuffer =
    options.privateDeployment
      ? mission.privateOperationalBufferMinutes ?? mission.operationalBufferMinutes
      : mission.operationalBufferMinutes;
  const operationalBufferMinutes =
    configuredBuffer ?? OPERATIONAL_BUFFER_MINUTES;
  const depositPercent = customQuoteRequired
    ? 0
    : mission.depositPercent ??
      (options.privateDeployment ? mission.privateDepositPercent ?? 0 : 0);
  const depositAmount = moneyRound((totalPrice * depositPercent) / 100);

  return {
    baseDurationMinutes: mission.durationMinutes,
    rotationExtensionMinutes,
    totalMissionMinutes: mission.durationMinutes + rotationExtensionMinutes,
    operationalBufferMinutes,
    totalBlockMinutes:
      mission.durationMinutes + rotationExtensionMinutes + operationalBufferMinutes,
    squadCount,
    rotationsRequired,
    rotationsIncluded,
    customQuoteRequired,
    packagePrice,
    additionalPlayerPrice,
    activationFee,
    minimumAdjustment,
    privateDeploymentMinimumApplied:
      Boolean(options.privateDeployment && mission.privateDeploymentMinimum) &&
      pricedSubtotal === mission.privateDeploymentMinimum &&
      mission.privateDeploymentMinimum > subtotalBeforeMinimum,
    depositPercent,
    depositAmount,
    totalPrice,
    currency: mission.currency
  };
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours} hr${hours === 1 ? '' : 's'}`;
  return `${hours} hr ${remainder} min`;
}

export function formatTime(time: string) {
  const [hourText, minute] = time.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

export function buildDateChoices(count = 10, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/St_Lucia', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  const today = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() + offset + 1);
    const format = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(date);
    return { value: date.toISOString().slice(0, 10), weekday: format({ weekday: 'short' }),
      day: format({ day: '2-digit' }), month: format({ month: 'short' }) };
  });
}

export function validCustomer(customer: CustomerProfile) {
  return customer.fullName.trim().length >= 2 && customer.fullName.length <= 120 &&
    customer.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim()) &&
    /^[+\d\s().-]+$/.test(customer.phone) &&
    customer.phone.replace(/\D/g, '').length >= 7 &&
    customer.phone.replace(/\D/g, '').length <= 15;
}
