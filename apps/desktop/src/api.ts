/** The API the preload script exposes to the renderer as `window.oxygenDesktop` */
export interface DesktopFile {
	path: string;
	name: string;
	text: string;
}

export interface DesktopGameStatus {
	connected: boolean;
	port: number;
	/** why the game link isn't listening (every port taken, …) */
	error?: string | null;
	installs: string[];
	/** where Deploy copies packs: a found install, or paths set in the Game menu */
	target: { name: string; custom: boolean; paths: DesktopDeployPaths } | null;
}

/** where packs are copied and the log is read (null: nowhere) */
export interface DesktopDeployPaths {
	resource: string;
	behavior: string | null;
	logs: string | null;
}

export interface DesktopLogEntry {
	file: string;
	level: string;
	message: string;
	expression: string | null;
	path: string | null;
}

/** Where updating the app stands (the same shapes as the editor's UpdateState) */
export type DesktopUpdateState =
	| { state: 'idle' }
	| { state: 'checking' }
	| { state: 'current'; version: string }
	| { state: 'available'; version: string; page?: string }
	| { state: 'downloading'; version: string; percent: number }
	| { state: 'ready'; version: string | null }
	| { state: 'error'; message: string }
	| { state: 'unsupported'; reason: string };

export interface DesktopApi {
	openFiles(): Promise<DesktopFile[]>;
	/** Write to `path`; with no path, ask where. Resolves with the file written, or null when cancelled. */
	save(path: string | null, name: string, text: string): Promise<{ path: string; name: string } | null>;
	openPack(): Promise<string | null>;
	/** ask for a picture file (Import texture image); null when cancelled */
	pickImage(): Promise<{ name: string; base64: string } | null>;
	readTexture(file: string | null, texture: string): Promise<string | null>;
	saveTexture(file: string | null, texture: string, pngBase64: string): Promise<boolean>;
	/** keep a screenshot or GIF in Pictures/Oxygen; resolves with its path */
	saveCapture(name: string, base64: string): Promise<string | null>;
	/** put a file on the clipboard as a file (pastes into chats and folders) */
	copyFile(path: string): Promise<boolean>;
	findEffect(file: string | null, identifier: string): Promise<string | null>;
	/** the pack file defining `identifier` (next to `file`), read for opening */
	openEffect(file: string | null, identifier: string): Promise<DesktopFile | null>;
	/** variables the pack's effects set, in their pre-effects, for `identifier` (variable → parents) */
	parentInputs(file: string | null, identifier: string): Promise<Record<string, string>>;
	readPackText(file: string | null, path: string): Promise<string | null>;
	writePackText(file: string | null, path: string, text: string): Promise<boolean>;
	examples(): Promise<{ name: string; text: string }[]>;
	openedAtStart(): Promise<DesktopFile[]>;
	/** recently used files, newest first */
	recent(): Promise<{ path: string; name: string; folder: string }[]>;
	openPath(path: string): Promise<DesktopFile | null>;
	/** the files open now (restored at the next start) */
	setOpenFiles(paths: string[]): void;
	watch(path: string): void;
	onExternalChange(cb: (path: string, text: string) => void): void;
	/** files opened from outside while Oxygen runs (Oxygen started again with them, or handed over by the OS) */
	onOpenRequested(cb: (files: DesktopFile[]) => void): void;
	onMenu(cb: (command: string) => void): void;
	settings(): Promise<Record<string, unknown>>;
	saveSettings(s: Record<string, unknown>): void;
	/** the keys the native menu shows for its commands (Electron accelerators; null: none) */
	setMenuKeys(keys: Record<string, string | null>): void;
	/** zoom the window's contents (1 = 100%) */
	setZoom(factor: number): void;
	updateStatus(): Promise<DesktopUpdateState>;
	onUpdateStatus(cb: (s: DesktopUpdateState) => void): void;
	checkForUpdates(): Promise<void>;
	downloadUpdate(): void;
	installUpdate(): void;
	setAutoUpdate(on: boolean): void;
	/** versions of what the app runs on, and where it keeps its settings */
	about(): Promise<{ app: string; electron: string; chrome: string; node: string; platform: string; settings: string }>;
	gameStatus(): Promise<DesktopGameStatus>;
	onGameStatus(cb: (s: DesktopGameStatus) => void): void;
	deploy(file: string | null): Promise<string>;
	/** deploy to a found install, or to paths set by hand; kept in settings.json */
	setDeployTarget(choice: { install: string } | { paths: DesktopDeployPaths }): Promise<DesktopGameStatus>;
	/** ask for one of the deploy paths (a folder; the log may be a file on macOS) */
	pickDeployPath(kind: keyof DesktopDeployPaths, current: string | null): Promise<string | null>;
	/** the behavior pack folder and content log a resource pack folder suggests */
	suggestDeployPaths(resource: string): Promise<DesktopDeployPaths>;
	command(commandLine: string): Promise<string>;
	/** spawn in front of the player: /particle, or Oxygen Link with a variable map */
	spawn(identifier: string, variables?: Record<string, number | number[]>, offset?: [number, number, number]): Promise<string>;
	onGameLog(cb: (entries: DesktopLogEntry[]) => void): void;
}
