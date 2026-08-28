import { validateFile } from './file-policy';

describe('file policy', () => {
  it('accepts matching PDF signatures', () => {
    const result = validateFile(Buffer.from('%PDF-1.7 test'), 'application/pdf', 'meeting.pdf');
    expect(result.size).toBeGreaterThan(0);
    expect(result.checksum).toHaveLength(64);
  });

  it.each([
    [Buffer.from('not pdf'), 'application/pdf', 'meeting.pdf'],
    [Buffer.from('%PDF-1.7'), 'image/png', 'meeting.png'],
    [Buffer.alloc(0), 'application/pdf', 'meeting.pdf'],
    [Buffer.from('%PDF-1.7'), 'application/pdf', '../../evil.exe'],
  ])('rejects unsafe input', (buffer, mime, name) => {
    expect(() => validateFile(buffer, mime, name)).toThrow();
  });

  it('rejects an oversized valid-looking file', () => {
    expect(() =>
      validateFile(
        Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(10 * 1024 * 1024)]),
        'application/pdf',
        'large.pdf',
      ),
    ).toThrow();
  });
});
