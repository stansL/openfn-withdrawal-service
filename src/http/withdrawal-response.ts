import type { WithdrawalRecord } from '../domain/types.js';
import { formatUsdCents } from '../domain/money.js';

export function toApiResponse(record: WithdrawalRecord) {
  return {
    id: record.id,
    account_id: record.accountId,
    status: record.status,
    authorisation_code: record.authorisationCode,
    amount_usd: formatUsdCents(record.amountUsdCents),
    target_currency: record.targetCurrency,
    converted_amount: record.convertedAmount,
    exchange_rate: record.exchangeRate,
    created_at: record.createdAt,
    expires_at: record.expiresAt,
  };
}
