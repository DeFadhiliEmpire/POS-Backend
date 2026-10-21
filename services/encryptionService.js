const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(process.env.MFA_ENCRYPTION_KEY, "hex");

if (KEY.length !== 32) {
  throw new Error("MFA_ENCRYPTION_KEY must be exactly 32 bytes");
}

function encrypt(text) {
  const iv = crypto.randomBytes(12); //initializer

  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(text, "utf-8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

function decrypt(payload) {
  if (!payload || typeof payload !== "string") {
    throw new Error("Invalid payload passed to decrypt()");
  }

  const [ivHex, authTagHex, encryptedHex] = payload.split(":");

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    KEY,
    Buffer.from(ivHex, "hex"),
  );

  decipher.setAuthTag(Buffer.from(authTagHex, "hex")); //integrity check

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

module.exports = { encrypt, decrypt };
