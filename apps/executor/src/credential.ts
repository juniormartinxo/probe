import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

// Compara `Authorization: Bearer <credencial>` em tempo constante (os resumos têm o mesmo tamanho).
export function credentialChecker(token: string): (authorization: string | undefined) => boolean {
  const expected = digest(`Bearer ${token}`);
  return (authorization) => authorization !== undefined && timingSafeEqual(digest(authorization), expected);
}
