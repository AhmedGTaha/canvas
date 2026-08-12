export function normalizeEmail(email: string) {
  return email.trim().normalize("NFKC").toLowerCase();
}
