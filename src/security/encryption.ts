import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

interface CipherEnvelope {
  v: 1;
  alg: "A256GCM";
  iv: string;
  ciphertext: string;
  tag: string;
}

function decodeMasterKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must contain exactly 32 bytes");
  }
  return key;
}

export class CredentialCipher {
  private readonly key: Buffer;

  constructor(encodedMasterKey: string) {
    this.key = decodeMasterKey(encodedMasterKey);
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const envelope: CipherEnvelope = {
      v: 1,
      alg: "A256GCM",
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    };
    return Buffer.from(JSON.stringify(envelope)).toString("base64url");
  }

  decrypt(serialized: string, context: string): string {
    let envelope: CipherEnvelope;
    try {
      envelope = JSON.parse(Buffer.from(serialized, "base64url").toString("utf8"));
    } catch {
      throw new Error("Invalid credential envelope");
    }
    if (envelope.v !== 1 || envelope.alg !== "A256GCM") {
      throw new Error("Unsupported credential envelope");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(envelope.iv, "base64url"),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("Credential envelope authentication failed");
    }
  }
}
