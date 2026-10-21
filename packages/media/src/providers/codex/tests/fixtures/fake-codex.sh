#!/bin/sh
# Stand-in for the `codex` CLI. Mimics `codex exec --output-last-message <file>`:
# writes an image into the run workspace and reports its path as the last message.
# Behaviour is driven by FAKE_CODEX_MODE so tests can exercise failure paths.

if [ "$1" = "--version" ]; then
	[ "$FAKE_CODEX_MODE" = "version-fail" ] && exit 1
	echo "codex-cli 0.0.0-fake"
	exit 0
fi

out_file=""
work_dir=""
prev=""
for arg in "$@"; do
	case "$prev" in
		--output-last-message) out_file="$arg" ;;
		-C) work_dir="$arg" ;;
		-i) echo "$arg" >> "${FAKE_CODEX_ARGS_LOG:-/dev/null}" ;;
	esac
	prev="$arg"
done

cat > "${FAKE_CODEX_PROMPT_LOG:-/dev/null}"
printf '%s\n' "$@" > "${FAKE_CODEX_ARGV_LOG:-/dev/null}"

case "$FAKE_CODEX_MODE" in
	crash) echo "codex exploded" >&2; exit 3 ;;
	hang) sleep 60; exit 0 ;;
	no-message) exit 0 ;;
	outside) printf '/etc/passwd' > "$out_file"; exit 0 ;;
	empty) : > "$work_dir/out.png"; printf '%s' "$work_dir/out.png" > "$out_file"; exit 0 ;;
	bad-ext) printf 'fake' > "$work_dir/out.bin"; printf '%s' "$work_dir/out.bin" > "$out_file"; exit 0 ;;
	*) printf 'fake-png-bytes' > "$work_dir/out.png"; printf 'Done.\n%s\n' "$work_dir/out.png" > "$out_file"; exit 0 ;;
esac
