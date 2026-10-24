// Type definitions only — data lives in Firestore

export interface CalcSheet {
	id: string;
	name: string;
	order: number;
	/** Set on a sub-calculation: the line whose `sub` this sheet feeds. Top-level sheets are tabs. */
	parentLineId?: string;
	createdAt: number;
}

export interface CalcLine {
	id: string;
	sheetId: string;
	input: string;
	order: number;
	pinned?: boolean;
	note?: string;
	createdAt: number;
	updatedAt: number;
}
