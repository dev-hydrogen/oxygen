import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { DesktopApi } from './api';

const on = <T extends unknown[]>(channel: string, cb: (...args: T) => void) => {
	ipcRenderer.on(channel, (_e, ...args) => cb(...(args as T)));
};

const api: DesktopApi = {
	openFiles: () => ipcRenderer.invoke('openFiles'),
	save: (path, name, text) => ipcRenderer.invoke('save', path, name, text),
	openPack: () => ipcRenderer.invoke('openPack'),
	readTexture: (file, texture) => ipcRenderer.invoke('readTexture', file, texture),
	saveTexture: (file, texture, png) => ipcRenderer.invoke('saveTexture', file, texture, png),
	findEffect: (file, identifier) => ipcRenderer.invoke('findEffect', file, identifier),
	openEffect: (file, identifier) => ipcRenderer.invoke('openEffect', file, identifier),
	parentInputs: (file, identifier) => ipcRenderer.invoke('parentInputs', file, identifier),
	readPackText: (file, path) => ipcRenderer.invoke('readPackText', file, path),
	writePackText: (file, path, text) => ipcRenderer.invoke('writePackText', file, path, text),
	examples: () => ipcRenderer.invoke('examples'),
	openedAtStart: () => ipcRenderer.invoke('openedAtStart'),
	recent: () => ipcRenderer.invoke('recent'),
	openPath: (path) => ipcRenderer.invoke('openPath', path),
	setOpenFiles: (paths) => ipcRenderer.send('openSet', paths),
	watch: (path) => ipcRenderer.send('watch', path),
	onExternalChange: (cb) => on('externalChange', cb),
	onOpenRequested: (cb) => on('openRequested', cb),
	onMenu: (cb) => on('menu', cb),
	settings: () => ipcRenderer.invoke('settings'),
	saveSettings: (s) => ipcRenderer.send('saveSettings', s),
	setMenuKeys: (keys) => ipcRenderer.send('menuKeys', keys),
	setZoom: (factor) => webFrame.setZoomFactor(factor),
	about: async () => {
		const own: { app: string; settings: string } = await ipcRenderer.invoke('about');
		return { ...own, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: `${process.platform} ${process.arch}` };
	},
	gameStatus: () => ipcRenderer.invoke('gameStatus'),
	onGameStatus: (cb) => on('gameStatus', cb),
	deploy: (file) => ipcRenderer.invoke('deploy', file),
	command: (line) => ipcRenderer.invoke('command', line),
	spawn: (identifier, variables, offset) => ipcRenderer.invoke('spawn', identifier, variables, offset),
	onGameLog: (cb) => on('gameLog', cb),
};

contextBridge.exposeInMainWorld('oxygenDesktop', api);
