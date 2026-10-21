/* The editor's command executor, once the Rust engine has loaded
 * (`migrate-editor-to-shared-rust-core`, task 4.5). The editor route renders
 * nothing editable until it is ready, because there is no second executor to
 * fall back to. */
import { useCallback, useEffect, useState } from "react";
import { engineExecutor, type CommandExecutor } from "@maleo/shared/editor";
import { loadEditorEngine } from "@services/editor-engine/engine-loader.ts";

export type EditorEngineState =
	| { status: "loading" }
	| { status: "ready"; executor: CommandExecutor }
	| { status: "failed"; retry: () => void };

export function useEditorEngine(): EditorEngineState {
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<EditorEngineState>({ status: "loading" });
	const retry = useCallback(() => setAttempt((count) => count + 1), []);
	useEffect(() => {
		let live = true;
		setState({ status: "loading" });
		loadEditorEngine().then(
			(engine) => {
				if (live) setState({ status: "ready", executor: engineExecutor(engine) });
			},
			(error: unknown) => {
				console.error("the editor engine did not load", error);
				if (live) setState({ status: "failed", retry });
			},
		);
		return () => {
			live = false;
		};
	}, [attempt, retry]);
	return state;
}
