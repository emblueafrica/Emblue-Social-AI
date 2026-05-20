// src/utils/cloudinary.ts - Cloudinary image upload utility
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

export interface UploadResult {
  url: string;
  secure_url: string;
  public_id: string;
  width?: number;
  height?: number;
  format?: string;
  error?: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasAllowedExtension(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(extname(filename).toLowerCase());
}

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function safePublicId(folder: string): string {
  return `${folder.replace(/[^a-zA-Z0-9/_-]/g, '')}/${randomUUID()}`;
}

export async function uploadImageFromUrl(
  sourceUrl: string,
  folder = 'social-emblue-ai',
  publicId?: string
): Promise<UploadResult> {
  if (!isHttpUrl(sourceUrl)) {
    return { url: '', secure_url: '', public_id: '', error: 'Invalid image URL' };
  }
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    return { url: sourceUrl, secure_url: sourceUrl, public_id: '', error: 'Cloudinary not configured' };
  }
  try {
    const result: UploadApiResponse = await cloudinary.uploader.upload(sourceUrl, {
      folder,
      public_id: publicId?.replace(/[^a-zA-Z0-9/_-]/g, '') ?? safePublicId(folder),
      resource_type: 'image',
      allowed_formats: ALLOWED_FORMATS,
    });
    return { url: result.url, secure_url: result.secure_url, public_id: result.public_id, width: result.width, height: result.height, format: result.format };
  } catch (err) {
    const e = err as UploadApiErrorResponse;
    return { url: '', secure_url: '', public_id: '', error: e.message ?? 'Upload failed' };
  }
}

export async function uploadImageBuffer(
  buffer: Buffer,
  filename: string,
  folder = 'social-emblue-ai'
): Promise<UploadResult> {
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { url: '', secure_url: '', public_id: '', error: 'Image exceeds 5MB limit' };
  }
  if (!hasAllowedExtension(filename)) {
    return { url: '', secure_url: '', public_id: '', error: 'Unsupported image extension' };
  }
  if (!detectImageMime(buffer)) {
    return { url: '', secure_url: '', public_id: '', error: 'Unsupported image signature' };
  }

  return new Promise((resolve) => {
    const stream = cloudinary.uploader.upload_stream({
      folder,
      public_id: safePublicId(folder),
      resource_type: 'image',
      allowed_formats: ALLOWED_FORMATS,
    },
    (error?: UploadApiErrorResponse, result?: UploadApiResponse) => {
      if (error || !result) { resolve({ url: '', secure_url: '', public_id: '', error: error?.message ?? 'Upload failed' }); return; }
      resolve({ url: result.url, secure_url: result.secure_url, public_id: result.public_id, width: result.width, height: result.height, format: result.format });
    });
    stream.end(buffer);
  });
}

export async function deleteImage(publicId: string): Promise<boolean> {
  try {
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch { return false; }
}

export function getTransformedUrl(
  publicId: string,
  width: number,
  height: number,
  format = 'webp'
): string {
  return cloudinary.url(publicId, {
    width, height, crop: 'fill', gravity: 'center',
    fetch_format: format, quality: 'auto',
  });
}
