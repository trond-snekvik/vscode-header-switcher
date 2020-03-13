// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'fast-glob';
import { EntryItem } from 'fast-glob/out/types/entries';


const header_extensions : string[] = ['h', 'hpp', 'hh', 'hxx'];
const source_extensions : string[] = ['c', 'cpp', 'cc', 'cxx'];

function filename_no_ext(filename: string): string {
	return path.basename(filename.split('.').slice(0, -1).join('.'));
}

function get_config(entry_name: string) {
	return vscode.workspace.getConfiguration('header-switcher').get(entry_name);
}

function common_prefix_len(string1: string, string2: string): number {
	var max = Math.min(string1.length, string2.length);
	for (var i = 0; i < max; ++i) {
		if (string1[i] !== string2[i]) {
			return i;
		}
	}
	return max;
}

function recursive_glob(original: string, pattern: string, basedir: string, topDir: string, maxCount: number): Promise<string> {
	if (basedir === topDir || basedir.length === 0 || maxCount === 0) {
		return Promise.reject('No match.');
	}
	return new Promise<string>((resolve, reject) => {
		glob(pattern, { cwd: basedir, ignore: [original]}).then((matches: EntryItem[]) => {
			if (matches.length > 0) {
				console.log(`Found using glob ${pattern}`);
				resolve(path.normalize(basedir + path.sep + matches.sort((a, b) => (common_prefix_len(a.toString(), original) - common_prefix_len(b.toString(), original)))[0]));
			}
			reject('No match.');
		});
	}).catch(e => recursive_glob(basedir, pattern, path.dirname(basedir), topDir, maxCount - 1));
}

function resolvePath(p: string) {

	p.replace(/${workspaceFolder(?::([^}]+))?}/, (str, g1) => {
		var folders = vscode.workspace.workspaceFolders;
		if (!folders) {
			return str;
		}
		if (!g1) {
			return folders[0].uri.fsPath;
		}
		var folder = folders.find(f => f.name === g1);
		if (!folder) {
			return str;
		}

		return folder.uri.fsPath;
	});

	if (path.isAbsolute(p)) {
		return p;
	}

	return path.resolve(vscode.workspace.workspaceFolders![0].uri.fsPath, p);
}

function find_replacements(folder: string, pairs: string[][]): {prev: string, new: string}[] {
	var pathMatch = (p: string) => folder.startsWith(p);

	return pairs.reduce((prev: string[][], pair: string[]) => {
		var existingIndex = pair.findIndex(pathMatch);
		if (existingIndex === 0) {
			prev.push(pair);
		} else if (existingIndex === 1) {
			prev.push(pair.reverse());
		}
		return prev;
	}, []).map(pair => { return { prev: pair[0], new: pair[1] }; });
}

var configPairs: string[][] = [];
var livePairs: string[][] = [];

function updateConfigPairs() {
	configPairs = [];
	var workspaces = vscode.workspace.workspaceFolders;
	if (!workspaces) {
		configPairs = (get_config('folder_pairs') as string[][]).map(p => p.map(resolvePath));
		return;
	}

	(get_config('folder_pairs') as string[][]).forEach(pair => {
		if (pair.every(path.isAbsolute)) {
			configPairs.push(pair);
			return;
		}


		workspaces!.forEach(workspace => {
			configPairs.push(pair.map(folder => path.isAbsolute(folder) ? folder : path.join(workspace.uri.fsPath, folder)));
		});
	});
}

function getPairs() {
	return configPairs.concat(livePairs);
}

function addPairs(new_pair: string[]) {
	new_pair = new_pair.map(resolvePath);

	if (!livePairs.find(existing => ((existing[0] === new_pair[0] && existing[1] === new_pair[1]) ||
									 (existing[0] === new_pair[1] && existing[1] === new_pair[0])))) {
		console.log(`Adding pair ${new_pair[0]} -> ${new_pair[1]}`);
		livePairs.push(new_pair);
	}
}

async function get_other_file(file: string): Promise<string> {
	const extension = path.extname(file).slice(1);
	var is_header = header_extensions.includes(extension);
	var is_source = source_extensions.includes(extension);

	if (!is_header && !is_source) {
		return Promise.reject('Not a C/C++ file.');
	}
	var filename = path.basename(file);

	var filename_match = filename_no_ext(file) + '.{' + (is_header ? source_extensions : header_extensions).join(',') + '}';

	var pairs = getPairs();

	return await new Promise(async (resolve, reject) => {
		var workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
		if (pairs) {

			var result = null;
			var folder = resolvePath(path.dirname(file));
			var replacements = find_replacements(folder, pairs);
			for (var i = 0; i < replacements.length; ++i) {
				var newfolder = folder.replace(replacements[i].prev, replacements[i].new);
				result = await glob(`${newfolder}/${filename_match}`, { cwd: workspaceRoot }).then(matches => {
					if (matches.length > 0) {
						var best = path.normalize(matches.sort((a, b) => (common_prefix_len(a.toString(), filename) - common_prefix_len(b.toString(), filename)))[0].toString());
						if (!path.isAbsolute(best)) {
							best = path.resolve(workspaceRoot, best);
						}
						console.log(`Found using pairs ${replacements[i].prev} -> ${replacements[i].new}`);
						return Promise.resolve(best);
					}
					return Promise.resolve(null);
				});
				if (result !== null) {
					return resolve(result);
				}
			}
		}

		var file_match = '**/' + filename_match;

		recursive_glob(file, file_match, path.dirname(file), workspaceRoot, 10).then(p => {
			addPairs([path.dirname(file), path.dirname(p)]);
			return resolve(p);
		}).catch(e => reject('not found'));
	});
}

function handle_switch() {
	get_other_file(vscode.window.activeTextEditor!.document.fileName)
		.then(file => {
			vscode.window.showTextDocument(vscode.Uri.file(file));
		}).catch(err => vscode.window.showInformationMessage(err));
}

export function activate(context: vscode.ExtensionContext) {
	updateConfigPairs();
	let disposable = vscode.commands.registerCommand('header-switcher.switch', handle_switch);
	context.subscriptions.push(disposable);

	disposable = vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('header-switcher')) {
			updateConfigPairs();
		}
	});
	context.subscriptions.push(disposable);
}

export function deactivate() {}
