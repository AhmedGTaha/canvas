"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { DomainError, userMessage } from "@/domain/shared/errors";
import { BrandService, ThemeService } from "@/domain/theme/services";
import type { BrandSettingsInput, ThemeSettingsInput } from "@/domain/theme/schemas";
import { requireAuthenticatedUser } from "@/server/auth/session";

export type AutosaveResult<T> = { ok: true; revision: number; value: T } | { ok: false; error: string; stale?: boolean; revision?: number };

function themeValue(value: ThemeSettingsInput): ThemeSettingsInput {
  return {
    lightTokens: value.lightTokens, darkTokens: value.darkTokens, radiusScale: value.radiusScale,
    spacingScale: value.spacingScale, shadowScale: value.shadowScale, fontScale: value.fontScale, borderScale: value.borderScale,
  };
}

export async function saveBrandAction(input: { projectId: string; expectedRevision: number; brand: BrandSettingsInput }): Promise<AutosaveResult<BrandSettingsInput>> {
  const user = await requireAuthenticatedUser();
  const service = new BrandService();
  try {
    const record = await service.update(user.id, input);
    revalidatePath(`/projects/${input.projectId}`);
    return { ok: true, revision: record.revision, value: { companyName: record.companyName, companyDescription: record.companyDescription, brandNotes: record.brandNotes } };
  } catch (error: unknown) {
    if (error instanceof DomainError && error.code === "CONFLICT") {
      const current = await service.read(user.id, input.projectId);
      return { ok: false, stale: true, revision: current.revision, error: error.message };
    }
    return { ok: false, error: error instanceof ZodError ? (error.issues[0]?.message ?? "Brand settings are invalid.") : userMessage(error, "Brand settings could not be saved.") };
  }
}

export async function saveThemeAction(input: { projectId: string; expectedRevision: number; theme: ThemeSettingsInput }): Promise<AutosaveResult<ThemeSettingsInput>> {
  const user = await requireAuthenticatedUser();
  const service = new ThemeService();
  try {
    const result = await service.update(user.id, input);
    revalidatePath(`/projects/${input.projectId}`);
    return { ok: true, revision: result.revision, value: themeValue(result) };
  } catch (error: unknown) {
    if (error instanceof DomainError && error.code === "CONFLICT") {
      const current = await service.read(user.id, input.projectId);
      return { ok: false, stale: true, revision: current.revision, error: error.message };
    }
    return { ok: false, error: error instanceof ZodError ? (error.issues[0]?.message ?? "Theme settings are invalid.") : userMessage(error, "Theme settings could not be saved.") };
  }
}

export async function resetThemeAction(input: { projectId: string; expectedRevision: number }): Promise<AutosaveResult<ThemeSettingsInput>> {
  const user = await requireAuthenticatedUser();
  try {
    const result = await new ThemeService().reset(user.id, input);
    revalidatePath(`/projects/${input.projectId}`);
    return { ok: true, revision: result.revision, value: themeValue(result) };
  } catch (error: unknown) {
    return { ok: false, error: userMessage(error, "Theme could not be reset.") };
  }
}
