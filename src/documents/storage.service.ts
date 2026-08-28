import { Injectable } from '@nestjs/common';

export interface StoredObject {
  key: string;
  size: number;
  checksum: string;
}

export abstract class ObjectStorageService {
  abstract put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

@Injectable()
export class InMemoryObjectStorageService extends ObjectStorageService {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, data: Buffer, _contentType: string): Promise<StoredObject> {
    void _contentType;
    this.objects.set(key, Buffer.from(data));
    return { key, size: data.length, checksum: '' };
  }

  async get(key: string): Promise<Buffer> {
    const data = this.objects.get(key);
    if (!data) throw new Error('Object not found');
    return Buffer.from(data);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
