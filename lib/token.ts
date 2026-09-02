export function isTokenExpired(expiresAtSeconds: number): boolean {
  return Date.now() >= expiresAtSeconds * 1000;
}
