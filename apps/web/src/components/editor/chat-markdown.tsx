/* Maleo — minimal, safe Markdown renderer for chat prose.
 *
 * Assistant messages arrive as light Markdown (the model writes **bold**, lists,
 * `code`, and links). We render to JSX directly — never innerHTML — so there is
 * no XSS surface: text nodes are inert and links are sanitized to http(s) only.
 * Scope is deliberately small (bold, italic, code, links, bullet/ordered lists,
 * paragraphs); anything richer belongs in an artifact card, not a chat bubble. */
import { Fragment } from "react";
import type { JSX, ReactNode } from "react";

// Only http/https/mailto survive — blocks javascript: and data: URI injection.
function safeHref(url: string): string | null {
	try {
		const u = new URL(url, "https://x.invalid");
		if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") return url;
		return null;
	} catch {
		return null;
	}
}

// Inline spans: `code`, **bold**, *italic*/_italic_, [text](url). Tokenized in one
// pass by the earliest match so nesting can't double-wrap or drop text.
function renderInline(text: string, keyBase: string): ReactNode[] {
	const out: ReactNode[] = [];
	let rest = text;
	let i = 0;
	const patterns: Array<{ re: RegExp; wrap: (m: RegExpMatchArray, key: string) => ReactNode }> = [
		{
			re: /`([^`]+)`/,
			wrap: (m, key) => (
				<code key={key} className="fc-md-code">
					{m[1]}
				</code>
			),
		},
		{ re: /\*\*([^*]+)\*\*/, wrap: (m, key) => <strong key={key}>{m[1]}</strong> },
		{ re: /(?:\*([^*]+)\*|_([^_]+)_)/, wrap: (m, key) => <em key={key}>{m[1] ?? m[2]}</em> },
		{
			re: /\[([^\]]+)\]\(([^)]+)\)/,
			wrap: (m, key) => {
				const href = safeHref(m[2]!);
				return href ? (
					<a key={key} href={href} target="_blank" rel="noopener noreferrer">
						{m[1]}
					</a>
				) : (
					<Fragment key={key}>{m[0]}</Fragment>
				);
			},
		},
	];
	while (rest) {
		let best: { idx: number; len: number; node: ReactNode; matchLen: number } | null = null;
		for (const p of patterns) {
			const m = rest.match(p.re);
			if (m && m.index != null && (best === null || m.index < best.idx)) {
				best = {
					idx: m.index,
					len: m.index,
					node: p.wrap(m, `${keyBase}-${i}`),
					matchLen: m[0].length,
				};
			}
		}
		if (!best) {
			out.push(<Fragment key={`${keyBase}-t${i}`}>{rest}</Fragment>);
			break;
		}
		if (best.idx > 0)
			out.push(<Fragment key={`${keyBase}-t${i}`}>{rest.slice(0, best.idx)}</Fragment>);
		out.push(best.node);
		rest = rest.slice(best.idx + best.matchLen);
		i++;
	}
	return out;
}

// Block layer: group lines into paragraphs and bullet/ordered lists. Blank lines
// separate paragraphs; consecutive "- "/"1. " lines fold into one list.
export function ChatMarkdown({ text }: { text: string }): JSX.Element {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const blocks: JSX.Element[] = [];
	let para: string[] = [];
	let list: { ordered: boolean; items: string[] } | null = null;
	const flushPara = (): void => {
		if (para.length === 0) return;
		const key = `p-${blocks.length}`;
		blocks.push(
			<p key={key} className="fc-md-p">
				{renderInline(para.join(" "), key)}
			</p>,
		);
		para = [];
	};
	const flushList = (): void => {
		if (!list) return;
		const key = `l-${blocks.length}`;
		const items = list.items.map((it, idx) => (
			<li key={`${key}-${idx}`}>{renderInline(it, `${key}-${idx}`)}</li>
		));
		blocks.push(
			list.ordered ? (
				<ol key={key} className="fc-md-list">
					{items}
				</ol>
			) : (
				<ul key={key} className="fc-md-list">
					{items}
				</ul>
			),
		);
		list = null;
	};
	for (const raw of lines) {
		const line = raw.trimEnd();
		const bullet = line.match(/^\s*[-*]\s+(.*)$/);
		const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
		if (bullet) {
			flushPara();
			if (list && !list.ordered) list.items.push(bullet[1]!);
			else {
				flushList();
				list = { ordered: false, items: [bullet[1]!] };
			}
			continue;
		}
		if (ordered) {
			flushPara();
			if (list && list.ordered) list.items.push(ordered[1]!);
			else {
				flushList();
				list = { ordered: true, items: [ordered[1]!] };
			}
			continue;
		}
		if (line.trim() === "") {
			flushPara();
			flushList();
			continue;
		}
		flushList();
		para.push(line);
	}
	flushPara();
	flushList();
	return <div className="fc-md">{blocks}</div>;
}

export default ChatMarkdown;
