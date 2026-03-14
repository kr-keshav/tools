import { browser } from '$app/environment';
import Dexie, { type Table } from 'dexie';

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
	priority: 0 | 1 | 2 | 3; // 0=none, 1=low, 2=medium, 3=high
	dueDate?: string; // ISO date-only: "2026-03-15"
	tags: string[];
	subtasks: Subtask[];
	createdAt: number;
	updatedAt: number;
	order: number;
	tabId: string;
}

class TodoDB extends Dexie {
	tasks!: Table<Task, string>;
	tabs!: Table<Tab, string>;

	constructor() {
		super('toolsApp_todo');
		this.version(1).stores({
			tasks: 'id, completed, dueDate, priority, createdAt, *tags',
		});
		this.version(2)
			.stores({
				tasks: 'id, completed, dueDate, priority, createdAt, *tags, tabId',
				tabs: 'id, order',
			})
			.upgrade((tx) => {
				// Migrate existing tasks to the default tab
				return tx
					.table('tasks')
					.toCollection()
					.modify((task: Task) => {
						if (!task.tabId) task.tabId = 'default';
					});
			});
	}
}

export const db = browser ? new TodoDB() : (null as unknown as TodoDB);
