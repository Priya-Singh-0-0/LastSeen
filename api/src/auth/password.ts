import argon2 from 'argon2';

/**
 * argon2id hash/verify — the only entry point for password operations (T8).
 *
 * Argon2id parameters follow OWASP 2023 recommendations:
 *   memoryCost: 65536 KiB (64 MiB)
 *   timeCost:   3 iterations
 *   parallelism: 4
 *
 * Never log a plaintext password or the returned hash in a user-visible field.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

/** Returns true if the plaintext matches the stored hash; never throws on mismatch. */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // Argon2 can throw on malformed hashes — treat as mismatch.
    return false;
  }
}
