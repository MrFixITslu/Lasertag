export interface PaymentRequest {
  amount: number;
  currency: 'XCD' | 'USD';
  bookingReference: string;
  customerEmail: string;
}

export interface PaymentResult {
  status: 'demo_approved' | 'requires_provider';
  transactionId?: string;
}

export interface PaymentProvider {
  createPayment(request: PaymentRequest): Promise<PaymentResult>;
}

/**
 * Development provider only.
 *
 * Replace this implementation with the selected Caribbean payment gateway.
 * The booking UI should depend on this interface rather than a vendor-specific SDK.
 */
export const demoPaymentProvider: PaymentProvider = {
  async createPayment(request) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return {
      status: 'demo_approved',
      transactionId: `DEMO-${request.bookingReference}`
    };
  }
};
