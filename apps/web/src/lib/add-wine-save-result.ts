export type AddWineSaveFailure = {
  ok: false;
  code: "version_conflict";
  message: string;
};

const VERSION_CONFLICT_MESSAGES = [
  "This wine changed after you opened it.",
  "This wine no longer exists in the version you opened.",
  "Supplier catalog wine not found for edit."
];

export function addWineSaveFailure(message: string | null | undefined): AddWineSaveFailure | null {
  const normalized = message?.trim() || "";
  if (!VERSION_CONFLICT_MESSAGES.some((candidate) => normalized.includes(candidate))) return null;

  return {
    ok: false,
    code: "version_conflict",
    message: "This wine was already saved or changed after you opened it. Your changes were not applied again. Refresh Add Wine and review the saved item before retrying."
  };
}
