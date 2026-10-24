import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Configured } from "./providers.js";

export interface LessonStorage {
  configured(): boolean;
  put?(key:string,body:Uint8Array,contentType:string):Promise<void>;
  upload(key: string, contentType: string, size: number): Promise<string>;
  head(key: string): Promise<{ size: number; contentType: string }>;
  readPrefix?(key: string, length: number): Promise<Uint8Array>;
  finalize(stagingKey: string, immutableKey: string): Promise<void>;
  download(key: string, fileName: string, attachment: boolean): Promise<string>;
}
function client() {
  return new S3Client({
    region: "auto",
    // Browser uploads supply the body later; an automatic checksum would sign the empty body.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}
export const r2LessonStorage: LessonStorage = {
  configured: r2Configured,
  async put(key,body,contentType) {
    await client().send(new PutObjectCommand({Bucket:process.env.R2_BUCKET,Key:key,Body:body,ContentType:contentType,ContentLength:body.length,CacheControl:"public,max-age=31536000,immutable"}),{abortSignal:AbortSignal.timeout(30_000)});
  },
  async upload(key, contentType, size) {
    return getSignedUrl(
      client(),
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      { expiresIn: 900, signableHeaders: new Set(["content-type"]) },
    );
  },
  async head(key) {
    const object = await client().send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    return {
      size: object.ContentLength || 0,
      contentType: object.ContentType || "",
    };
  },
  async finalize(stagingKey, immutableKey) {
    const s3 = client();
    await s3.send(
      new CopyObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: immutableKey,
        CopySource: `${process.env.R2_BUCKET}/${stagingKey.split("/").map(encodeURIComponent).join("/")}`,
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    // Only the staging key was exposed in the PUT URL. Ready objects cannot be overwritten by that URL.
    await s3
      .send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: stagingKey,
        }),
        { abortSignal: AbortSignal.timeout(10_000) },
      )
      .catch(() => undefined);
  },
  async readPrefix(key, length) {
    const object = await client().send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Range: `bytes=0-${length - 1}`,
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    if (!object.Body) throw new Error("Image object is empty.");
    return object.Body.transformToByteArray();
  },
  async download(key, fileName, attachment) {
    return getSignedUrl(
      client(),
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        ResponseContentDisposition: `${attachment ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      }),
      { expiresIn: attachment ? 300 : 3600 },
    );
  },
};
