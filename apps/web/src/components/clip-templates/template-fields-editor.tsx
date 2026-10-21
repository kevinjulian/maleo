import { useRef, useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { uploadReferenceImage } from "@api/media.ts";
import type { TemplateField } from "@models/clip-templates/types.ts";
import { Button } from "@design-system/components/button.tsx";
import type { TemplateParamRow, TemplateParamValue, TemplateParams } from "@maleo/shared";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";

// Renders the structured content form for a text template (see
// clip-templates/*.ts `fields` schemas) — text/textarea/number/image/list
// inputs bound to a TextOverlay's `params` object. Keeps content editing
// (this) separate from style editing (font/color controls in EditModalHost).
/** A row field shown in a text input: its string, or empty for anything else. */
const stringField = (value: unknown): string => (typeof value === "string" ? value : "");

export function TemplateFieldsEditor({
	fields,
	values,
	onChange,
}: {
	fields: TemplateField[];
	values: TemplateParams;
	onChange: (next: TemplateParams) => void;
}): JSX.Element {
	const set = (key: string, value: TemplateParamValue): void =>
		onChange({ ...values, [key]: value });
	return (
		<div className="tl2-tplfields">
			{fields.map((field) => (
				<TemplateFieldInput
					key={field.key}
					field={field}
					value={values[field.key]}
					onChange={(v) => set(field.key, v)}
				/>
			))}
		</div>
	);
}

function TemplateFieldInput({
	field,
	value,
	onChange,
}: {
	field: TemplateField;
	value: TemplateParamValue | undefined;
	onChange: (value: TemplateParamValue) => void;
}): JSX.Element {
	if (field.type === "text") {
		return (
			<label className="tl2-tplfield">
				<span className="tl2-tplfield-label">{field.label}</span>
				<Input
					type="text"
					value={typeof value === "string" ? value : ""}
					placeholder={field.placeholder}
					onChange={(e) => onChange(e.target.value)}
				/>
			</label>
		);
	}
	if (field.type === "textarea") {
		return (
			<label className="tl2-tplfield">
				<span className="tl2-tplfield-label">{field.label}</span>
				<Textarea
					rows={3}
					value={typeof value === "string" ? value : ""}
					placeholder={field.placeholder}
					onChange={(e) => onChange(e.target.value)}
				/>
			</label>
		);
	}
	if (field.type === "number") {
		return (
			<label className="tl2-tplfield">
				<span className="tl2-tplfield-label">{field.label}</span>
				<Input
					type="number"
					min={field.min}
					max={field.max}
					step={field.step ?? 1}
					value={typeof value === "number" ? value : ""}
					onChange={(e) => onChange(Number(e.target.value))}
				/>
			</label>
		);
	}
	if (field.type === "image") {
		return (
			<TemplateImageField
				field={field}
				value={typeof value === "string" ? value : undefined}
				onChange={(url) => onChange(url ?? "")}
			/>
		);
	}
	// list
	/* A list field's rows are objects. A stored param could hold a scalar under
	 * this key — an older template, or a hand-edited document — so non-objects are
	 * dropped rather than rendered as a broken row. */
	const rows: TemplateParamRow[] = Array.isArray(value)
		? value.filter(
				(r): r is TemplateParamRow => Boolean(r) && typeof r === "object" && !Array.isArray(r),
			)
		: [];
	const setRow = (i: number, patch: TemplateParamRow): void =>
		onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
	const addRow = (): void =>
		onChange([...rows, Object.fromEntries(field.itemFields.map((f) => [f.key, ""]))]);
	const removeRow = (i: number): void => onChange(rows.filter((_, idx) => idx !== i));
	return (
		<div className="tl2-tplfield">
			<span className="tl2-tplfield-label">{field.label}</span>
			<div className="tl2-tpllist">
				{rows.map((row, i) => (
					<div key={i} className="tl2-tpllist-row">
						{field.itemFields.map((itemField) => (
							<Input
								className="sm"
								key={itemField.key}

								type="text"
								placeholder={
									itemField.type === "text" || itemField.type === "textarea"
										? itemField.placeholder
										: itemField.label
								}
								value={stringField(row[itemField.key])}
								onChange={(e) => setRow(i, { [itemField.key]: e.target.value })}
							/>
						))}
						<IconButton
							size="xs"
							type="button"
							title={`Remove ${field.itemLabel.toLowerCase()}`}
							onClick={() => removeRow(i)}
						>
							{Ic.x(ICON.sm)}
						</IconButton>
					</div>
				))}
				<Button type="button" variant="secondary" size="sm" onClick={addRow}>
					{Ic.plus(ICON.xs)} Add {field.itemLabel.toLowerCase()}
				</Button>
			</div>
		</div>
	);
}

function TemplateImageField({
	field,
	value,
	onChange,
}: {
	field: Extract<TemplateField, { type: "image" }>;
	value: string | undefined;
	onChange: (value: string | undefined) => void;
}): JSX.Element {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const onPickFile = async (file: File | null): Promise<void> => {
		if (!file) return;
		setError(null);
		setBusy(true);
		try {
			const url = await uploadReferenceImage(file);
			onChange(url);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};
	return (
		<label className="tl2-tplfield">
			<span className="tl2-tplfield-label">{field.label}</span>
			<input
				ref={fileInputRef}
				type="file"
				accept="image/png,image/jpeg,image/webp,image/avif,image/svg+xml"
				style={{ display: "none" }}
				onChange={(e) => {
					void onPickFile(e.currentTarget.files?.[0] ?? null);
					e.currentTarget.value = "";
				}}
			/>
			<div className="tl2-tplimg">
				{value ? (
					<img src={value} alt="" className="tl2-tplimg-preview" />
				) : (
					<div className="tl2-tplimg-empty">{Ic.image(ICON.md)}</div>
				)}
				<div className="tl2-tplimg-actions">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={busy}
						onClick={() => fileInputRef.current?.click()}
					>
						{busy ? <span className="cv-spin" /> : Ic.upload(ICON.xs)}{" "}
						{value ? "Replace" : "Upload"}
					</Button>
					{value && (
						<IconButton
							size="xs"
							type="button"
							title="Remove image"
							onClick={() => onChange(undefined)}
						>
							{Ic.x(ICON.sm)}
						</IconButton>
					)}
				</div>
			</div>
			{error && <p className="tl2-tplfield-error">{error}</p>}
		</label>
	);
}
