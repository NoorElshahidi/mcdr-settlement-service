import { z } from 'zod';

export const meetingDraftSchema = z.object({
  meetingAt: z.string().min(1, 'Meeting date and time is required.'),
  capital: z.coerce.number().positive('Capital must be positive.'),
  documentId: z.string().min(1, 'An approved attachment is required.'),
});

export const settlementDraftSchema = z.object({
  crn: z.string().trim().min(1, 'CRN is required.'),
  meetings: z.array(meetingDraftSchema).min(1).max(20),
});
