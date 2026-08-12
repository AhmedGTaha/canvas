import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
export default function NotFound() { return <main className="standalone-state"><ErrorState title="Page not found" description="This page does not exist, or you do not have access to it." retry={<Link href="/dashboard" className={buttonClass()}>Back to projects</Link>} /></main>; }
