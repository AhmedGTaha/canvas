export function StatusBadge({ status }: { status: "active" | "archived" | "deleted" }) {
  return <span className={`status status-${status}`}>{status}</span>;
}
