import React, { useEffect } from "react";

interface ToastProps {
	message: string;
	tone?: "ok" | "err";
	onClose: () => void;
	duration?: number;
}

export function Toast({ message, tone = "ok", onClose, duration = 3000 }: ToastProps) {
	useEffect(() => {
		const t = setTimeout(onClose, duration);
		return () => clearTimeout(t);
	}, [onClose, duration]);
	return <div className={`toast ${tone}`}>{message}</div>;
}
