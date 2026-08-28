import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ObjectStorageService, StoredObject } from './storage.service';

@Injectable()
export class MinioStorageService extends ObjectStorageService {
  private readonly client = new S3Client({
    endpoint: process.env.MINIO_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
    },
  });
  private readonly bucket = process.env.MINIO_BUCKET ?? 'mcdr-documents';

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const checksum = createHash('sha256').update(data).digest('hex');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        Metadata: { checksum },
      }),
    );
    return { key, size: data.length, checksum };
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error('Object body missing');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
