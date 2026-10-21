export interface PromptFragment {
	owner: string;
	parts: readonly string[];
	variables: readonly {
		name: string;
		type: string;
		required: boolean;
		source: string;
		default?: string;
		condition?: string;
	}[];
	condition?: string;
}

/** The same interpolation as a native template literal, using inspectable fixed parts. */
export function renderPromptParts(parts: readonly string[], values: readonly unknown[]): string {
	if (parts.length !== values.length + 1)
		throw new Error("Prompt fragment interpolation count does not match");
	let result = parts[0]!;
	for (let index = 0; index < values.length; index++)
		result += `${values[index]}${parts[index + 1]}`;
	return result;
}
