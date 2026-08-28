import { describe, expect, it } from 'vitest';
import {
  isRetryableStatus,
  paymentLabel,
  retryDelayMs,
  unreadCount,
  validateMeetingDrafts,
} from './portal.logic';

const valid = { meetingAt: '2025-01-01T10:00', capital: '100', documentId: 'doc-1' };

describe('owner portal validation', () => {
  it('requires one to twenty complete meetings', () => {
    expect(validateMeetingDrafts([])).toBeTruthy();
    expect(validateMeetingDrafts([valid])).toBeNull();
    expect(validateMeetingDrafts([{ ...valid, capital: '0' }])).toContain('positive capital');
    expect(validateMeetingDrafts([{ ...valid, documentId: '' }])).toContain('attachment');
  });
  it('renders payment and notification state consistently', () => {
    expect(paymentLabel('AWAITING_PAYMENT')).toBe('Pay now');
    expect(paymentLabel('PARTIALLY_SETTLED')).toBe('PARTIALLY SETTLED');
    expect(unreadCount([{ readAt: null }, { readAt: '2025-01-01' }, {}])).toBe(2);
  });
  it('retries only server errors, with a growing but capped delay', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(retryDelayMs(0)).toBe(300);
    expect(retryDelayMs(1)).toBe(600);
    expect(retryDelayMs(10)).toBe(4000);
  });
});
