/* Snapshot rendered React components and native controls for OpenSpec inventory. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dir, "..");
const SRC = resolve(ROOT, "src");
const config = ts.readConfigFile(resolve(ROOT, "tsconfig.json"), ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT).options;

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = resolve(dir, name);
		return statSync(path).isDirectory()
			? files(path)
			: path.endsWith(".tsx") && !path.endsWith(".test.tsx")
				? [path]
				: [];
	});
}

function hasJsx(node: ts.Node | undefined): boolean {
	if (!node) return false;
	if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
		return true;
	return ts.forEachChild(node, hasJsx) ?? false;
}

const modules = files(SRC).map((file) => ({
	file,
	ast: ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	),
}));
type Entry = { name: string; owner: string; exported: boolean; consumers: string[] };
const components = new Map<string, Entry>();
const reexports = new Map<string, string>();
const wildcards: Array<[string, string]> = [];
for (const { file, ast } of modules) {
	for (const node of ast.statements) {
		if (
			!ts.isExportDeclaration(node) ||
			!node.moduleSpecifier ||
			!ts.isStringLiteral(node.moduleSpecifier)
		)
			continue;
		const resolved = ts.resolveModuleName(node.moduleSpecifier.text, file, options, ts.sys)
			.resolvedModule?.resolvedFileName;
		if (!resolved) continue;
		if (!node.exportClause) {
			wildcards.push([file, resolved]);
			continue;
		}
		if (!ts.isNamedExports(node.exportClause)) continue;
		for (const element of node.exportClause.elements)
			reexports.set(
				`${file}#${element.name.text}`,
				`${resolved}#${element.propertyName?.text ?? element.name.text}`,
			);
	}
	for (const node of ast.statements) {
		const declarations =
			ts.isFunctionDeclaration(node) && node.name
				? [{ name: node.name.text, body: node.body }]
				: ts.isVariableStatement(node)
					? node.declarationList.declarations
							.filter((d) => ts.isIdentifier(d.name))
							.map((d) => ({ name: d.name.getText(ast), body: d.initializer }))
					: [];
		for (const { name, body } of declarations) {
			if (!/^[A-Z]/.test(name) || !hasJsx(body)) continue;
			const owner = relative(ROOT, file);
			components.set(`${file}#${name}`, {
				name,
				owner,
				exported:
					(ts.canHaveModifiers(node) &&
						ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) ??
					false,
				consumers: [],
			});
		}
	}
}
for (const [barrel, target] of wildcards) {
	for (const [key, entry] of components)
		if (key.startsWith(`${target}#`)) reexports.set(`${barrel}#${entry.name}`, key);
}

const controls: Array<{ owner: string; kind: string; line: number }> = [];
for (const { file, ast } of modules) {
	const imports = new Map<string, string>();
	for (const node of ast.statements) {
		if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
		const resolved = ts.resolveModuleName(node.moduleSpecifier.text, file, options, ts.sys)
			.resolvedModule?.resolvedFileName;
		if (!resolved) continue;
		for (const element of node.importClause?.namedBindings &&
		ts.isNamedImports(node.importClause.namedBindings)
			? node.importClause.namedBindings.elements
			: []) {
			imports.set(
				element.name.text,
				`${resolved}#${element.propertyName?.text ?? element.name.text}`,
			);
		}
	}
	function visit(node: ts.Node): void {
		if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
			const tag = node.tagName.getText(ast);
			const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
			const owner = relative(ROOT, file);
			if (/^[A-Z]/.test(tag)) {
				const key = imports.get(tag) ?? `${file}#${tag}`;
				const entry = components.get(reexports.get(key) ?? key);
				if (entry) entry.consumers.push(`${owner}:${line}`);
			} else {
				const attr = (name: string): string | undefined => {
					const value = node.attributes.properties.find(
						(p) => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === name,
					);
					return value && ts.isJsxAttribute(value)
						? value.initializer?.getText(ast).replace(/^"|"$/g, "")
						: undefined;
				};
				if (["select", "input", "textarea"].includes(tag))
					controls.push({
						owner,
						kind: tag === "input" ? `input:${attr("type") ?? "text"}` : tag,
						line,
					});
				if (
					["tab", "menu", "menuitem", "tooltip", "switch", "checkbox", "slider"].includes(
						attr("role") ?? "",
					)
				)
					controls.push({ owner, kind: `role:${attr("role")}`, line });
				if (attr("title")) controls.push({ owner, kind: `title:${tag}`, line });
			}
		}
		if (
			ts.isJsxAttribute(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "component" &&
			node.initializer &&
			ts.isJsxExpression(node.initializer) &&
			node.initializer.expression &&
			ts.isIdentifier(node.initializer.expression)
		) {
			const entry = components.get(
				imports.get(node.initializer.expression.text) ??
					`${file}#${node.initializer.expression.text}`,
			);
			if (entry)
				entry.consumers.push(
					`${relative(ROOT, file)}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`,
				);
		}
		ts.forEachChild(node, visit);
	}
	visit(ast);
}

const output = {
	components: [...components.values()]
		.filter((entry) => entry.consumers.length)
		.sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name)),
	unrendered: [...components.values()]
		.filter((entry) => !entry.consumers.length)
		.sort((a, b) => a.owner.localeCompare(b.owner)),
	controls,
};
if (process.argv.includes("--markdown")) {
	console.log("| Rendered component and owner | Direct JSX/render-prop call sites |");
	console.log("| --- | --- |");
	for (const entry of output.components) {
		const byFile = new Map<string, string[]>();
		for (const site of entry.consumers) {
			const split = site.lastIndexOf(":");
			const path = site.slice(0, split);
			byFile.set(path, [...(byFile.get(path) ?? []), site.slice(split + 1)]);
		}
		const sites = [...byFile].map(([path, lines]) => `\`${path}:${lines.join(",")}\``).join(", ");
		console.log(`| \`${entry.owner}#${entry.name}\` | ${sites} |`);
	}
	console.log("\n| Native control/tooltip and owner | Source lines |");
	console.log("| --- | --- |");
	const native = new Map<string, number[]>();
	for (const control of controls) {
		const key = `${control.owner}#${control.kind}`;
		native.set(key, [...(native.get(key) ?? []), control.line]);
	}
	for (const [key, lines] of [...native].sort(([a], [b]) => a.localeCompare(b))) {
		console.log(`| \`${key}\` | ${[...new Set(lines)].join(", ")} |`);
	}
	process.exit(0);
}
console.log(JSON.stringify(output, null, 2));
