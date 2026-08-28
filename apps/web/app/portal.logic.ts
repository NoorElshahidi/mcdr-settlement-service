export type MeetingDraft = { meetingAt: string; capital: string; documentId: string };

export function validateMeetingDrafts(meetings: MeetingDraft[]): string | null {
  if (meetings.length < 1 || meetings.length > 20) return 'Add between 1 and 20 meetings.';
  if (meetings.some((meeting) => !meeting.meetingAt || Number(meeting.capital) <= 0))
    return 'Each meeting needs a date and positive capital.';
  if (meetings.some((meeting) => !meeting.documentId))
    return 'Each meeting needs an approved attachment.';
  return null;
}

export function paymentLabel(status: string): string {
  return status === 'AWAITING_PAYMENT' ? 'Pay now' : status.replaceAll('_', ' ');
}

export function unreadCount(items: Array<{ readAt?: string | null }>): number {
  return items.filter((item) => !item.readAt).length;
}

// Only server errors are transient; 4xx (auth/permission/validation) never
// gets more likely to succeed by retrying, so those must not be retried.
export function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

export function retryDelayMs(attempt: number): number {
  return Math.min(300 * 2 ** attempt, 4000);
}
