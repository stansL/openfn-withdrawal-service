export interface Principal { subjectId: string }

export interface FxQuote {
  rate: string;
  provider: string;
  /** Provider-effective reference-rate date, not the local fetch timestamp. */
  effectiveDate: string;
}

export interface WithdrawalRecord {
  id: string;
  accountId: string;
  subjectId: string;
  status: 'authorised' | 'expired';
  authorisationCode: string;
  amountUsdCents: number;
  targetCurrency: string;
  convertedAmount: string;
  exchangeRate: string;
  fxProvider: string;
  fxEffectiveDate: string;
  createdAt: string;
  expiresAt: string;
  idempotencyKey?: string;
  requestHash?: string;
}
