import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const PBKDF2_ITERATIONS = 120000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";

function deriveHash(password: string, salt: string) {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST).toString(
    "hex"
  );
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return {
    passwordHash: deriveHash(password, salt),
    passwordSalt: salt,
  };
}

export function verifyPassword(
  password: string,
  passwordHash?: string,
  passwordSalt?: string
) {
  if (!passwordHash || !passwordSalt) {
    return false;
  }

  const expected = Buffer.from(passwordHash, "hex");
  const actual = Buffer.from(deriveHash(password, passwordSalt), "hex");

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
