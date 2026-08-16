import { starterCatalogView } from "@/domain/blocks/starter-library/catalog";
import { StarterSectionService } from "@/domain/blocks/starter-library/service";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { getCurrentUser } from "@/server/auth/session";
import { apiErrorResponse, apiJsonHeaders } from "@/server/http/errors";

/**
 * The built-in starter catalog.
 *
 * Application-owned and identical for every project, so this returns identity and
 * description only — never template source, which is an implementation detail of the
 * copy a project receives.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    await new ProjectAccessService().requireProjectAccess(user.id, projectId);
    return Response.json({ starters: starterCatalogView() }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "The starter library could not be loaded."); }
}

/** Copies one starter into this project as a normal, project-owned Building Block. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { projectId } = await params;
    const body = await request.json() as { starterId?: unknown; name?: unknown; isGlobal?: unknown };
    const block = await new StarterSectionService().use(user.id, { projectId, starterId: body.starterId, name: body.name, isGlobal: body.isGlobal });
    return Response.json({ block }, { headers: apiJsonHeaders });
  } catch (error) { return apiErrorResponse(error, "That starter section could not be added to this website."); }
}
