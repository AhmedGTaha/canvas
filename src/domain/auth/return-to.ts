import { inviteTokenSchema } from "@/domain/collaboration/schemas";

export function safeReturnTo(value: unknown) {
  if (typeof value !== "string") return "/dashboard";
  const match = /^\/invite\/([^/?#]+)$/.exec(value);
  return match?.[1] && inviteTokenSchema.safeParse(match[1]).success ? value : "/dashboard";
}
