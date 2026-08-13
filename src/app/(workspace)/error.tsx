"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return <div className="standalone-state">
    <ErrorState
      title="This website could not be opened"
      description="Something went wrong while loading the workspace. Your pages and content are safe."
      retry={<div className="inline-actions">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard" className="button button-secondary">All websites</Link>
      </div>}
    />
  </div>;
}
