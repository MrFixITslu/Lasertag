export type Currency = 'XCD' | 'USD';
export type BookingMode = 'instant' | 'request';
export type PricingMode = 'fixed' | 'per_participant';

export interface MissionPackage {
  id: string;
  name: string;
  callSign: string;
  category: 'public' | 'birthday' | 'community' | 'school' | 'corporate' | 'resort';
  bookingMode: BookingMode;
  pricingMode: PricingMode;
  price: number;
  currency: Currency;
  durationMinutes: number;
  minPlayers: number;
  maxConcurrentPlayers: number;
  description: string;
  highlights: string[];
  priceLabel?: string;
  timeLabel?: string;
  includedPlayers?: number;
  extraPlayerPrice?: number;
  minimumCharge?: number;
  activationFee?: number;
  depositPercent?: number;
  privateDepositPercent?: number;
  privateDeploymentMinimum?: number;
  operationalBufferMinutes?: number;
  privateOperationalBufferMinutes?: number;
  standardPricingMaxPlayers?: number;
  customQuoteMessage?: string;
  rotationIncludedPlayers?: number;
  rotationGroupSize?: number;
  rotationExtensionMinutes?: number;
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
  /** Legacy alias retained for existing booking/admin data. */
  squadCount: number;
  teamCount: number;
  teamSizes: number[];
  matchRotation: Array<[number, number]>;
  rotationsRequired: boolean;
  rotationsIncluded: boolean;
  customQuoteRequired: boolean;
  packagePrice: number;
  additionalPlayerPrice: number;
  activationFee: number;
  minimumAdjustment: number;
  privateDeploymentMinimumApplied: boolean;
  depositPercent: number;
  depositAmount: number;
  totalPrice: number;
  currency: Currency;
}
