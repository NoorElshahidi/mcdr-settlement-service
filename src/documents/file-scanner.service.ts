import { Injectable } from '@nestjs/common';
import { Socket } from 'node:net';

export abstract class FileScannerService {
  abstract scan(data: Buffer): Promise<boolean>;
}

@Injectable()
export class ClamAvScannerService extends FileScannerService {
  async scan(data: Buffer): Promise<boolean> {
    const host = process.env.CLAMAV_HOST ?? 'localhost';
    const port = Number(process.env.CLAMAV_PORT ?? 3310);
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      socket.setTimeout(15_000);
      socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      socket.on('error', reject);
      socket.on('timeout', () => socket.destroy(new Error('ClamAV scan timed out')));
      socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8').includes('OK')));
      socket.connect(port, host, () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < data.length; offset += 8192) {
          const chunk = data.subarray(offset, offset + 8192);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
        socket.end();
      });
    });
  }
}
