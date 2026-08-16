import Link from "next/link";
import { CanvasLogo } from "@/components/brand/canvas-logo";
import { buttonClass } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

/**
 * The only screen in the product that renders outside every shell, so it is the
 * only one that has to carry the brand itself. It uses the same logo component
 * as the title bar rather than a second, smaller mark.
 */
export default function NotFound() {
  return <main className="standalone-state">
    <p className="standalone-brand"><Link href="/"><CanvasLogo /></Link></p>
    <ErrorState title="Page not found" description="This page does not exist, or you do not have access to it." retry={<Link href="/dashboard" className={buttonClass()}>Back to projects</Link>} />
  </main>;
}
