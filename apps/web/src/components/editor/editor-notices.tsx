import { Button } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";

export function EditorNotices({
	saveError,
	retrying,
	retrySave,
	dismissSaveError,
	agentFailed,
	retryInitial,
	running,
}: {
	saveError: string | null;
	retrying: boolean;
	retrySave: () => Promise<void>;
	dismissSaveError: () => void;
	agentFailed: boolean;
	retryInitial: () => void;
	running: boolean;
}) {
	const style = {
		display: "flex",
		alignItems: "center",
		padding: "8px 16px",
		background: "var(--err-bg)",
		color: "var(--err)",
		fontSize: 12.5,
		borderBottom: "1px solid var(--border)",
	};
	return (
		<>
			{saveError && (
				<div role="alert" style={{ ...style, gap: 8 }}>
					<span style={{ flex: 1 }}>{saveError}</span>
					<Button size="sm" loading={retrying} onClick={() => void retrySave()}>
						Retry save
					</Button>
					<IconButton size="xs" onClick={dismissSaveError} title="Dismiss">
						{Ic.x(ICON.sm)}
					</IconButton>
				</div>
			)}
			{agentFailed && (
				<div role="alert" style={{ ...style, gap: 10 }}>
					<span style={{ flex: 1 }}>
						Generation didn’t produce anything. Your project and brief are saved.
					</span>
					<Button variant="primary" size="sm" onClick={retryInitial} disabled={running}>
						{Ic.regen(ICON.sm)} Retry
					</Button>
				</div>
			)}
		</>
	);
}
