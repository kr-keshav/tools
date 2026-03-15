// Type definitions only — data lives in Firestore

export interface Subtask {
	id: string;
	title: string;
	completed: boolean;
}

export interface Tab {
	id: string;
	name: string;
	order: number;
}

export interface Task {
	id: string;
	title: string;
	notes: string;
	completed: boolean;
	completedAt?: number;
	priority: 0 | 1 | 2 | 3;
	dueDate?: string;
	tags: string[];
	subtasks: Subtask[];
	createdAt: number;
	updatedAt: number;
	order: number;
	tabId: string;
}
