/* Keyframes the opencut-classic way: every animatable inspector row carries a
 * keyframe toggle before its label (outline none at the playhead, filled keyed),
 * unavailable while the playhead is outside the clip. A keyed property's value edit
 * writes a key at the playhead; an unkeyed one edits the static value. Key timing,
 * easing and removal live on the timeline. One scrub or field edit is one
 * undo step. A row (Position: X and Y) shares one toggle and keys together. */
import { Fragment, useRef, useState, type JSX, type ReactNode } from "react";
import type { NumericAnimationProperty } from "@maleo/shared";
import type { EditorCommand, EditScope } from "@maleo/shared/editor";
import { rowKeyingAt, type ClipAnimationTarget } from "@models/timeline/clip-animation-edit.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { usePlayheadSec } from "@hooks/timeline/use-playhead.ts";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Note } from "@design-system/components/note.tsx";
import { AmountField, FieldRow } from "@design-system/patterns/inspector.tsx";
import { dbFromGain, faderRangeDb, gainFromDb } from "@models/timeline/audio-fader.ts";

export interface KeyControls {
	/** The property has at least one key. */
	animated: boolean;
	/** A key sits exactly at the inspected time. */
	keyed: boolean;
	/** Sampled at the playhead when animated, else the static value. Registry units. */
	value: number;
	/** The toggle needs the playhead inside an unlocked clip. */
	toggleDisabled: boolean;
	/** A keyed value cannot be edited outside the clip; a static one can. */
	valueDisabled: boolean;
	toggle: () => void;
	/** Writes a key when animated; otherwise calls the row's static setter. */
	setValue: (value: number, setStatic: (value: number) => void) => void;
}
export type Keying = (property: NumericAnimationProperty) => KeyControls | undefined;

/** One keyframe toggle for a row of properties (Position is X and Y): keyed when any
 *  of them has a key at the playhead, animated when any has keys at all. */
export interface RowKeyControls {
	animated: boolean;
	keyed: boolean;
	toggleDisabled: boolean;
	valueDisabled: boolean;
	/** Each row property sampled at the playhead (or static). Registry units. */
	values: Partial<Record<NumericAnimationProperty, number>>;
	/** On: keys every row property without a key here. Off: removes the row's keys here. */
	toggle: () => void;
	/** In an animated row, keys the given values and every other row property at its
	 *  sampled value, as one undo step; otherwise calls the static writer. */
	setValues: (
		values: Partial<Record<NumericAnimationProperty, number>>,
		writeStatic: () => void,
	) => void;
}
export type RowKeying = (
	properties: readonly NumericAnimationProperty[],
) => RowKeyControls | undefined;

export function useClipKeying({
	target,
	store,
	writers,
	playhead,
	fps,
}: {
	target: ClipAnimationTarget | undefined;
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	playhead: PlayheadHandle;
	fps: number;
}) {
	const doc = useDocumentSelector(store, (value) => value.getDoc()),
		absolute = usePlayheadSec(playhead);
	const [error, setError] = useState<string | null>(null);
	const run = (build: (scope: EditScope) => EditorCommand) => {
		try {
			writers.apply((scope) => build(scope));
			setError(null);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Keyframe edit failed");
		}
	};
	const rowKeying: RowKeying = (properties) => {
		const row = target && rowKeyingAt(doc, target, properties, absolute, fps);
		if (!row) return undefined;
		return {
			animated: row.animated,
			keyed: row.keyed,
			toggleDisabled: row.toggleDisabled,
			valueDisabled: row.valueDisabled,
			values: row.values,
			toggle: () => run(row.toggle),
			setValues: (values, writeStatic) =>
				row.animated ? run((scope) => row.set(scope, values)) : writeStatic(),
		};
	};
	// One property is a row of one: the same toggle, the same keyed edit.
	const keying: Keying = (property) => {
		const row = target && rowKeyingAt(doc, target, [property], absolute, fps);
		if (!row) return undefined;
		return {
			animated: row.animated,
			keyed: row.keyed,
			value: row.values[property]!,
			toggleDisabled: row.toggleDisabled,
			valueDisabled: row.valueDisabled,
			toggle: () => run(row.toggle),
			// An animated property keys at the playhead; an unanimated one edits its static value.
			setValue: (v, setStatic) =>
				row.animated ? run((scope) => row.set(scope, { [property]: v })) : setStatic(v),
		};
	};
	return { keying, rowKeying, error };
}

/** The keyframe toggle that precedes a property's label. */
export function KeyToggle({
	label,
	controls,
}: {
	label: string;
	controls: Pick<KeyControls, "keyed" | "toggleDisabled" | "toggle">;
}): JSX.Element {
	return (
		<IconButton
			size="xs"
			className="tl2-key-toggle"
			aria-label={`${label} keyframe`}
			aria-pressed={controls.keyed}
			disabled={controls.toggleDisabled}
			title={
				controls.toggleDisabled
					? "Move the playhead inside the clip to keyframe"
					: controls.keyed
						? `Remove ${label.toLowerCase()} keyframe`
						: `Add ${label.toLowerCase()} keyframe`
			}
			onClick={controls.toggle}
		>
			{Ic.keyframe(ICON.xs)}
		</IconButton>
	);
}

/** Brackets one interaction with the rows inside as a single undo step. */
export function KeyGesture({
	writers,
	children,
}: {
	writers: DocumentWriters;
	children: ReactNode;
}): JSX.Element {
	const open = useRef(false);
	const begin = () => {
		if (!open.current) {
			open.current = true;
			writers.beginGesture();
		}
	};
	const end = () => {
		if (open.current) {
			open.current = false;
			writers.endGesture();
		}
	};
	return (
		<div
			className="tl2-key-gesture"
			onPointerDownCapture={begin}
			onFocusCapture={begin}
			onPointerUpCapture={end}
			onPointerCancelCapture={end}
			onBlurCapture={end}
		>
			{children}
		</div>
	);
}

export function KeyingError({ error }: { error: string | null }): JSX.Element | null {
	return error ? <Note tone="error">{error}</Note> : null;
}

/** One animatable value in a keyed row. `scale` maps registry units to display
 *  units (opacity ×100). `disabled` greys the cell on its own (Scale while unlocked). */
export type KeyedCell = {
	property: NumericAnimationProperty;
	label: string;
	short: ReactNode;
	value: number;
	setStatic: (value: number) => void;
	suffix?: string;
	min?: number;
	max?: number;
	step?: number;
	scale?: number;
	disabled?: boolean;
	/** The row values one edit keys, given the edited value and the row's current
	 *  values (a locked size keys width and height together). Defaults to just this one. */
	keys?: (
		value: number,
		current: Partial<Record<NumericAnimationProperty, number>>,
	) => Partial<Record<NumericAnimationProperty, number>>;
};
const isKeyedCell = (cell: KeyedCell | ReactNode): cell is KeyedCell =>
	typeof cell === "object" && cell !== null && "property" in cell;

/** A FieldRow whose animatable cells share one keyframe toggle before the row label.
 *  Other cells (a lock, a flip, a select) sit between them unkeyed. Without row
 *  keying it is a plain static row. */
export function KeyedFieldRow({
	label,
	cells,
	keying,
	onReset,
}: {
	label: string;
	cells: readonly (KeyedCell | ReactNode)[];
	keying?: RowKeying;
	onReset?: () => void;
}): JSX.Element {
	const keyed = cells.filter(isKeyedCell);
	const controls = keying?.(keyed.map((c) => c.property));
	return (
		<FieldRow
			label={label}
			onReset={onReset}
			beforeLabel={controls && <KeyToggle label={label} controls={controls} />}
		>
			{cells.map((cell, i) => {
				if (!isKeyedCell(cell)) return <Fragment key={i}>{cell}</Fragment>;
				const scale = cell.scale ?? 1,
					value = controls?.values[cell.property] ?? cell.value;
				return (
					<AmountField
						key={i}
						label={cell.label}
						short={cell.short}
						suffix={cell.suffix}
						min={cell.min}
						max={cell.max}
						step={cell.step}
						value={value * scale}
						disabled={cell.disabled || controls?.valueDisabled}
						onChange={(d) => {
							const v = d / scale;
							if (!controls) return cell.setStatic(v);
							controls.setValues(
								cell.keys ? cell.keys(v, controls.values) : { [cell.property]: v },
								() => cell.setStatic(v),
							);
						}}
					/>
				);
			})}
		</FieldRow>
	);
}

/** Gain keys, on the Audio group: the toggle before the label arms gain; once keyed the
 *  value edits in dB at the playhead. Static gain stays with the clip's level controls. */
export function GainKeyRow({ keying }: { keying: Keying }): JSX.Element | null {
	const controls = keying("volume");
	if (!controls) return null;
	const range = faderRangeDb();
	const db = Number(Math.max(-range, dbFromGain(controls.value)).toFixed(2));
	return (
		<FieldRow label="Gain" beforeLabel={<KeyToggle label="Gain" controls={controls} />}>
			{controls.animated ? (
				<AmountField
					label="Gain"
					short="dB"
					suffix="dB"
					min={-range}
					max={0}
					step={1}
					value={db}
					disabled={controls.valueDisabled}
					onChange={(v) => controls.setValue(gainFromDb(v), () => undefined)}
				/>
			) : (
				<span>{Math.round(db)} dB</span>
			)}
		</FieldRow>
	);
}
