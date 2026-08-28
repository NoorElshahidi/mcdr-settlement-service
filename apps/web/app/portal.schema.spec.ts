import { describe, expect, it } from 'vitest';
import { settlementDraftSchema } from './portal.schema';

describe('settlement form schema', () => {
  it('rejects blank CRNs and incomplete meetings', () => {
    expect(settlementDraftSchema.safeParse({ crn: '', meetings: [] }).success).toBe(false);
  });
  it('coerces capital and accepts a complete request', () => {
    const result = settlementDraftSchema.safeParse({
      crn: 'CRN-1',
      meetings: [{ meetingAt: '2025-01-01T10:00', capital: '100', documentId: 'doc-1' }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.meetings[0].capital).toBe(100);
  });
});
