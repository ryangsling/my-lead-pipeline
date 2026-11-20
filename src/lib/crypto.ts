import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";

const key = () => Buffer.from(env.ENCRYPTION_KEY, "base64");

/** Encrypts with AES-256-GCM. Output is `iv.tag.data`, each part base64. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

/** Decrypts a blob from `encrypt`. Throws if the blob was altered. */
export function decrypt(blob: string): string {
  const [iv, tag, data] = blob.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Shows only the last 4 characters of a secret. */
export function mask(secret: string): string {
  return secret.length <= 4 ? "****" : `****${secret.slice(-4)}`;
}
