const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function encryptBodyWithKey(body: string, addressKey: string) {
  if (body.length === 0) {
    return "";
  }

  const key = await deriveKey(addressKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(body),
  );

  const payload = new Uint8Array(iv.length + cipherBuffer.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(cipherBuffer), iv.length);

  return toBase64(payload);
}

export async function decryptBodyWithKey(payload: string, addressKey: string) {
  if (!payload) {
    return "";
  }

  const raw = fromBase64(payload);
  const iv = raw.slice(0, 12);
  const cipher = raw.slice(12);
  const key = await deriveKey(addressKey);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipher,
  );

  return textDecoder.decode(decrypted);
}

export function isBodyEncryptionAvailable() {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

async function deriveKey(addressKey: string) {
  const normalized = addressKey.toLowerCase();
  const hash = await crypto.subtle.digest("SHA-256", textEncoder.encode(normalized));

  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
