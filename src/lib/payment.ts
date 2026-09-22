export interface PaymentRequest {
  amount: number;
  currency: 'XCD' | 'USD';
  bookingReference: string;
  customerEmail: string;
}

export interface PaymentResult {
  status: 'requires_provider';
  transactionId?: string;
}

export interface PaymentProvider {
  createPayment(request: PaymentRequest): Promise<PaymentResult>;
}

/**
 * Unavailable provider: fail closed until live processing is implemented.
 *
 * Replace this implementation with the selected Caribbean payment gateway.
 * The booking UI should depend on this interface rather than a vendor-specific SDK.
 */
export const demoPaymentProvider: PaymentProvider = {
  async createPayment(request) {
    void request;
    return { status: 'requires_provider' };
  }
};
