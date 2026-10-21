import { getGlobalSetting, setGlobalSetting } from "@maleo/db/global-settings";

export type RegistrationPolicy = "open" | "invitation_only";
const KEY = "registration.policy";

export async function registrationPolicy(): Promise<{
	stored: RegistrationPolicy;
	effective: RegistrationPolicy;
	source: "environment" | "stored";
}> {
	const stored: RegistrationPolicy =
		(await getGlobalSetting(KEY)) === "open" ? "open" : "invitation_only";
	const override = process.env.MALEO_ALLOW_SIGNUP;
	return override === undefined
		? { stored, effective: stored, source: "stored" }
		: { stored, effective: override === "1" ? "open" : "invitation_only", source: "environment" };
}

export async function selfRegistrationEnabled(): Promise<boolean> {
	return (await registrationPolicy()).effective === "open";
}

export async function setRegistrationPolicy(value: RegistrationPolicy): Promise<void> {
	await setGlobalSetting(KEY, value);
}
