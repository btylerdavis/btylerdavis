"use server";

import { refresh } from "next/cache";
import { requestDeletion } from "@/lib/compliance/deletion";

/**
 * Participant-page deletion request (SPEC §9.4 one-tap withdrawal, the demo
 * cut): files a DeletionRequest for the compliance console to execute. The
 * page re-renders via refresh() and shows the pending state; duplicate
 * pending requests and already-deleted records are refused server-side in
 * requestDeletion (the form simply re-renders against the true state).
 */
export async function fileDeletionRequest(formData: FormData): Promise<void> {
  const participantId = formData.get("participantId");
  const note = formData.get("note");
  if (typeof participantId !== "string" || participantId.length === 0) return;
  await requestDeletion(participantId, typeof note === "string" ? note : undefined);
  refresh();
}
