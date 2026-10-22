const speakeasy = require("speakeasy");
const QRCode = require("qrcode");

const { encrypt, decrypt } = require("./encryptionService.js");

function generateSecret(email, businessName) {
  return speakeasy.generateSecret({
    name: `${businessName}:${email}`,
    issuer: `${businessName}`,
    length: 32,
  });
}

async function generateQRCode(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

function verifyToken(encryptedSecret, token) {
  const secret = decrypt(encryptedSecret);

  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
  });
}

module.exports = { generateSecret, generateQRCode, encrypt, verifyToken };
