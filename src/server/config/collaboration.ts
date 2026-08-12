function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const collaborationConfig = {
  inviteLifetimeDays: positiveInteger(process.env.INVITE_TTL_DAYS, 7),
  leaseDurationSeconds: positiveInteger(process.env.LEASE_DURATION_SECONDS, 60),
} as const;
