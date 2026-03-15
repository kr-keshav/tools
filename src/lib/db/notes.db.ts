// Type definitions only — data lives in Firestore

export interface Note {
	id: string;
	title: string;
	body: string;
	tags: string[];
	color: string | null;
	pinned: boolean;
	folder: string | null;
	deletedAt: number | null;
	createdAt: number;
	updatedAt: number;
}

export interface NoteVersion {
	id: string;
	noteId: string;
	title: string;
	body: string;
	savedAt: number;
}
