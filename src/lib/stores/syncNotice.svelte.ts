export const syncNotice = $state({ writeRejected: false });

/** The server refused a save. Every other failure is retried by Firestore, so stays quiet. */
export function reportWriteError(e: unknown) {
	if ((e as { code?: string } | null)?.code === 'permission-denied') syncNotice.writeRejected = true;
}
