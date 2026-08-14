import { Badge, type Tone } from "./feedback";

const TONE: Record<"active" | "archived" | "deleted", Tone> = { active: "success", archived: "neutral", deleted: "danger" };
const LABEL: Record<"active" | "archived" | "deleted", string> = { active: "Active", archived: "Archived", deleted: "Deleted" };

export function StatusBadge({ status }: { status: "active" | "archived" | "deleted" }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
