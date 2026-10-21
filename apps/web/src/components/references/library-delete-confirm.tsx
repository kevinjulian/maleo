import type { JSX } from "react";
import { Modal } from "@design-system/components/modal.tsx";
import { Button } from "@design-system/components/button.tsx";

/* Exported for test: the copy has to name the store the row actually leaves,
 * which is the distinction this dialog exists to make. */
export function DeleteConfirm({
	label,
	kind,
	count,
	scenes,
	deleting,
	error,
	onCancel,
	onConfirm,
}: {
	label: string;
	kind: "reference" | "note";
	count: number;
	scenes: number;
	deleting: boolean;
	error: string | null;
	onCancel: () => void;
	onConfirm: () => void;
}): JSX.Element {
	return (
		<Modal
			title={kind === "note" ? "Delete note?" : "Delete reference?"}
			sub={label}
			onClose={onCancel}
			width={400}
		>
			<div className="cv-reflib-confirm">
				{kind === "note" ? (
					<p>
						<b>{label}</b> will be removed from this project&apos;s notes.
					</p>
				) : (
					<p>
						<b>{label}</b> is used in <b>{count}</b> place{count === 1 ? "" : "s"}
						{scenes > 0 && (
							<>
								{" "}
								and cast in <b>{scenes}</b> scene{scenes === 1 ? "" : "s"}, which will lose it
							</>
						)}
						. Deleting removes it from the workspace library.
					</p>
				)}
				{error && (
					<div role="alert" className="cv-reflib-confirm-err">
						{error}
					</div>
				)}
				<div className="cv-modal-actions">
					<Button variant="ghost" onClick={onCancel} disabled={deleting}>
						Cancel
					</Button>
					<Button variant="danger" onClick={onConfirm} disabled={deleting}>
						{deleting ? "Deleting…" : "Delete"}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
