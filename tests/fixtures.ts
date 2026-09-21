import { ProjectItem, ProjectMasterSettings, DEFAULT_SETTINGS } from "../src/types";

/**
 * 测试夹具（非测试文件：文件名不含 .test，vitest 不会收集）。
 */

export function projectItem(
	overrides: Partial<ProjectItem> & { name: string; path?: string },
): ProjectItem {
	const path = overrides.path ?? `100 Projects/${overrides.name}.md`;
	const segments = path.split("/");
	return {
		status: "active",
		startDate: null,
		dueDate: null,
		completionDate: null,
		progress: null,
		priority: null,
		area: null,
		objective: null,
		context: null,
		remark: null,
		longTerm: false,
		mainProject: false,
		projectId: null,
		color: null,
		projectLeader: null,
		projectMembers: [],
		tags: [],
		file: {
			path,
			name: overrides.name,
			folder: segments.slice(0, -1).join("/"),
		},
		...overrides,
	};
}

export function settings(overrides: Partial<ProjectMasterSettings> = {}): ProjectMasterSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}
