export type Currency = 'XCD' | 'USD';
export type BookingMode = 'instant' | 'request';
export type PricingMode = 'fixed' | 'per_participant';

export interface MissionPackage {
  id: string;
  name: string;
  callSign: string;
  category: 'public' | 'birthday' | 'community' | 'corporate' | 'resort';
  bookingMode: BookingMode;
  pricingMode: PricingMode;
  price: number;
  currency: Currency;
  durationMinutes: number;
  minPlayers: number;
  maxConcurrentPlayers: number;
  description: string;
  highlights: string[];
}

export interface CustomerProfile {
  fullName: string;
  email: string;
  phone: string;
  marketingOptIn: boolean;
}

export interface BookingDraft {
  missionId: string;
  players: number;
  date: string;
  time: string;
  venueType: string;
  area: string;
  address: string;
  weatherFlexible: boolean;
  notes: string;
  customer: CustomerProfile;
}

export interface BookingSummary {
  baseDurationMinutes: number;
  rotationExtensionMinutes: number;
  totalMissionMinutes: number;
  operationalBufferMinutes: number;
  totalBlockMinutes: number;
  squadCount: number;
  rotationsRequired: boolean;
  totalPrice: number;
  currency: Currency;
}
