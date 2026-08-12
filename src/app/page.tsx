import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";

export default async function HomePage() {
  redirect((await getCurrentUser()) ? "/dashboard" : "/sign-in");
}
