"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { ProjectInstructionService } from "@/domain/ai/instruction-service";
import { DomainError, userMessage } from "@/domain/shared/errors";
import { requireAuthenticatedUser } from "@/server/auth/session";

export type InstructionSaveResult = { ok: true; revision: number; content: string } | { ok: false; error: string; stale?: boolean; revision?: number };

export async function saveProjectInstructionsAction(input: { projectId: string; expectedRevision: number; content: string }): Promise<InstructionSaveResult> {
  const user = await requireAuthenticatedUser();
  const service = new ProjectInstructionService();
  try {
    const result = await service.update(user.id, input);
    revalidatePath(`/projects/${input.projectId}`);
    revalidatePath(`/projects/${input.projectId}/panel/settings`);
    return { ok: true, revision: result.revisionNumber, content: result.content };
  } catch (error) {
    if (error instanceof DomainError && error.code === "CONFLICT") {
      const current = await service.read(user.id, input.projectId);
      return { ok: false, stale: true, revision: current.revisionNumber, error: error.message };
    }
    return { ok: false, error: error instanceof ZodError ? (error.issues[0]?.message ?? "Project instructions are invalid.") : userMessage(error, "Project instructions could not be saved.") };
  }
}

