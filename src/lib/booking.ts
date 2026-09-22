import type { BookingSummary, MissionPackage } from '../types';

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

export function calculateBookingSummary(
  mission: MissionPackage,
  players: number
): BookingSummary {
  const normalizedPlayers = Math.max(MIN_PLAYERS, Math.floor(players || MIN_PLAYERS));
  const overflowPlayers = Math.max(0, normalizedPlayers - MAX_CONCURRENT_PLAYERS);
  const extraRotationGroups = Math.ceil(overflowPlayers / ROTATION_GROUP_SIZE);
  const rotationExtensionMinutes = extraRotationGroups * ROTATION_EXTENSION_MINUTES;
  const squadCount = Math.ceil(normalizedPlayers / ROTATION_GROUP_SIZE);

  const totalPrice =
    mission.pricingMode === 'per_participant'
      ? mission.price * normalizedPlayers
      : mission.price;

  return {
    baseDurationMinutes: mission.durationMinutes,
    rotationExtensionMinutes,
    totalMissionMinutes: mission.durationMinutes + rotationExtensionMinutes,
    operationalBufferMinutes: OPERATIONAL_BUFFER_MINUTES,
    totalBlockMinutes:
      mission.durationMinutes + rotationExtensionMinutes + OPERATIONAL_BUFFER_MINUTES,
    squadCount,
    rotationsRequired: normalizedPlayers > MAX_CONCURRENT_PLAYERS,
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

export function buildDateChoices(count = 10) {
  const dates: Array<{ value: string; weekday: string; day: string; month: string }> = [];
  const now = new Date();

  for (let offset = 1; offset <= count; offset += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    dates.push({
      value: date.toISOString().slice(0, 10),
      weekday: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date),
      day: new Intl.DateTimeFormat('en', { day: '2-digit' }).format(date),
      month: new Intl.DateTimeFormat('en', { month: 'short' }).format(date)
    });
  }

  return dates;
}

export function isDemoSlotUnavailable(date: string, time: string) {
  if (!date) return false;
  const day = Number(date.slice(-2));
  return (day + Number(time.slice(0, 2))) % 7 === 0;
}
