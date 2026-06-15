import { describe, expect, it } from 'vitest';

import { detectImageMime } from '../src/report.js';

describe('detectImageMime', () => {
  it('detects PNG from its magic bytes', () => {
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
  });

  it('detects JPEG from its magic bytes', () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe('image/jpeg');
  });

  it('detects WebP (RIFF....WEBP)', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'ascii'),
    ]);
    expect(detectImageMime(webp)).toBe('image/webp');
  });

  it('detects GIF', () => {
    expect(detectImageMime(Buffer.from('GIF89a', 'ascii'))).toBe('image/gif');
  });

  it('defaults to PNG for unrecognized/empty bytes (back-compat)', () => {
    expect(detectImageMime(Buffer.from([0x00, 0x01, 0x02]))).toBe('image/png');
    expect(detectImageMime(Buffer.alloc(0))).toBe('image/png');
  });
});
