/** What the surrounding app (browser, VS Code webview, Electron) provides to the Oxygen UI */
export interface Host {
	kind: 'web' | 'vscode' | 'desktop';
	/** Ask the user for particle files to open */
	openFiles?(): Promise<OpenedFile[]>;
	/** Ask the user for a resource pack folder (used to resolve textures and child effects). Resolves with its name, or null when cancelled. */
	openPack?(): Promise<string | null>;
	/** Write a document back to where it came from. Returns the new path when saved somewhere new. */
	save(file: FileRef, text: string): Promise<FileRef | null>;
	/** Write a document somewhere new the user picks. Returns where, or null when it was handed off (a download). */
	saveAs?(file: FileRef, text: string): Promise<FileRef | null>;
	/** Where a save went, when it isn't plain (" in this browser"); appended to the "Saved …" notice */
	savedNote?(file: FileRef): string | null;
	/** Hand the user a copy of the document as a downloaded file */
	download?(file: FileRef, text: string): void;
	/** Bundled example effects */
	examples(): Promise<{ name: string; load: () => Promise<string> }[]>;
	/** Open an example the host's own way (VS Code: a new untitled document in its own editor) */
	openExample?(name: string): void;
	/** Resolve a texture path from a particle file (`textures/particle/foo`) to an image URL */
	resolveTexture(texture: string, file: FileRef): Promise<string | null>;
	/** Read a text file from the file's pack (`lighting/global.json`, texture sets). Null when absent. */
	readPackText?(path: string, file: FileRef): Promise<string | null>;
	/** Write a text file into the file's pack (texture sets). Returns false when the host can't. */
	writePackText?(path: string, file: FileRef, text: string): Promise<boolean>;
	/** Write an edited texture (PNG) back to the pack. Returns false when the host can't (the UI then downloads it). */
	saveTexture?(texture: string, file: FileRef, png: Blob): Promise<boolean>;
	/** Find another effect's JSON text by identifier (pack, bundled examples); used for child effects in events */
	findEffect?(identifier: string): Promise<string | null>;
	/**
	 * Open another effect by identifier (a child an event spawns). Resolves with the document to open here,
	 * 'shown' when the host opened it itself (another VS Code editor), or null when it isn't in the pack.
	 */
	openEffect?(identifier: string): Promise<OpenedFile | 'shown' | null>;
	/**
	 * Variables that effects in the pack set for `identifier` in the pre-effects of the events that spawn it
	 * (variable → their identifiers), so reads the child relies on its parents for aren't reported as unset.
	 */
	parentInputs?(identifier: string, file: FileRef): Promise<Record<string, string>>;
	/**
	 * Oxygen changed a document (edit, undo or redo inside Oxygen). Hosts that own the file text (VS Code)
	 * mirror these minimal edits; `edits` are relative to the text before the change.
	 */
	onDocumentChange?(file: FileRef, change: { edits: { offset: number; length: number; content: string }[]; label: string }, text: string): void;
	/** The host owns undo/redo (VS Code's document history); Oxygen then forwards Ctrl+Z / Ctrl+Y */
	undo?(file: FileRef): void;
	redo?(file: FileRef): void;
	/** Link to a running Minecraft (desktop app) */
	game?: GameLink;
	/** Recently opened files, newest first (hosts that remember them) */
	recentFiles?(): Promise<FileRef[]>;
	/** Open a file by its identity (a recent file); null when it's gone */
	openFile?(file: FileRef): Promise<OpenedFile | null>;
	/** The open documents changed; hosts that restore them next time keep the list */
	onOpenFilesChanged?(files: FileRef[]): void;
	/** Persisted UI settings (layout, preferences) */
	loadSettings(): Promise<Record<string, unknown>>;
	saveSettings(settings: Record<string, unknown>): void;
	/** Where the settings are kept, in words (Settings › Data) */
	settingsLocation?: string;
	/** Zoom the whole interface (1 = 100%), for hosts that own their window (desktop) */
	setZoom?(factor: number): void;
	/** The keys the host's own menu shows and answers to, as Electron accelerators by menu command (null: none) */
	setMenuKeys?(keys: Record<string, string | null>): void;
	/** What the host knows about where Oxygen runs (versions of Electron, VS Code…), for About › System */
	about?(): Promise<{ label: string; value: string }[]>;
}

export interface GameStatus {
	connected: boolean;
	port: number;
	/** the link couldn't listen for the game (shown in the Game menu) */
	error?: string | null;
	/** installed games that packs can be deployed to */
	installs: string[];
}

export interface GameLink {
	status(): Promise<GameStatus>;
	onStatus(cb: (s: GameStatus) => void): void;
	/** Copy the file's resource pack into the game's development packs. Resolves with what happened. */
	deploy(file: FileRef): Promise<string>;
	/**
	 * Spawn an effect in front of the connected player. With variables it goes through the Oxygen Link
	 * behavior pack (a script's spawnParticle with a MolangVariableMap); without, through /particle.
	 * `offset` moves it from that spot along the world axes, in blocks (scene effects keep their layout).
	 */
	spawn(identifier: string, variables?: Record<string, number | number[]>, offset?: [number, number, number]): Promise<string>;
	/** Ask the game to reload packs (`/reload all`) */
	reload(): Promise<string>;
}

export interface FileRef {
	/** Display name, e.g. `fire.particle.json` */
	name: string;
	/** Host-specific identity (path, URI, file handle id); null for unsaved documents */
	id: string | null;
	/** Where it lives, for lists like Recent (a folder, "in this browser"); hosts whose ids are paths can leave it out */
	where?: string;
}

export interface OpenedFile {
	file: FileRef;
	text: string;
}
