"use client";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState description="This page could not be loaded. Nothing was lost — try again." retry={<Button onClick={reset}>Try again</Button>} />;
}
