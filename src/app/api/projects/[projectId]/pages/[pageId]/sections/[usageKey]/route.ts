import { PageSectionService } from "@/domain/blocks/page-sections";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

/**
 * Removes a reusable section from this page.
 *
 * This removes the page's *usage* of the section — the Building Block host in
 * the page's source and the usage row that mirrors it. The Building Block itself stays
 * in the project library, and every other page that uses it is untouched.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string; pageId: string; usageKey: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId, pageId, usageKey } = await params;
    const result = await new PageSectionService().removeSection(user.id, { projectId, pageId, usageKey: decodeURIComponent(usageKey) });
    return Response.json({ section: result }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "That section could not be removed from this page."); }
}
