import { createHash } from 'node:crypto';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

const signatures: Readonly<Record<string, readonly number[]>> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

export function validateFile(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): { checksum: string; size: number } {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error('Unsupported file type');
  if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES) throw new Error('Invalid file size');
  const extension = originalName.toLowerCase().split('.').pop();
  const expectedExtension =
    mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg';
  if (extension !== expectedExtension && !(mimeType === 'image/jpeg' && extension === 'jpeg'))
    throw new Error('File extension does not match MIME type');
  const signature = signatures[mimeType];
  if (!signature || !signature.every((value, index) => buffer[index] === value))
    throw new Error('File signature does not match MIME type');
  return { checksum: createHash('sha256').update(buffer).digest('hex'), size: buffer.length };
}
