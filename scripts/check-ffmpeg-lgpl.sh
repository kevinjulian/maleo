#!/bin/sh
# Fails unless the FFmpeg at $1 is the render host's licensed build (OpenSpec
# p2-export E5): LGPL (no --enable-gpl, no --enable-nonfree), shared, with
# libopenh264 as an H.264 encoder and the native AAC encoder. The Dockerfile's
# ffmpeg-lgpl stage runs it, so an image with the wrong FFmpeg does not build.
#
#   scripts/check-ffmpeg-lgpl.sh /opt/ffmpeg-lgpl/bin/ffmpeg
set -eu
ffmpeg="${1:?usage: check-ffmpeg-lgpl.sh <ffmpeg>}"
conf="$("$ffmpeg" -hide_banner -buildconf)"
encoders="$("$ffmpeg" -hide_banner -encoders)"
failed=0
case "$conf" in *--enable-gpl*) echo "check-ffmpeg-lgpl: $ffmpeg is built with --enable-gpl" >&2; failed=1 ;; esac
case "$conf" in *--enable-nonfree*) echo "check-ffmpeg-lgpl: $ffmpeg is built with --enable-nonfree" >&2; failed=1 ;; esac
case "$conf" in *--enable-libopenh264*) ;; *) echo "check-ffmpeg-lgpl: $ffmpeg is built without --enable-libopenh264" >&2; failed=1 ;; esac
echo "$encoders" | grep -q ' libopenh264 ' || { echo "check-ffmpeg-lgpl: $ffmpeg has no libopenh264 encoder" >&2; failed=1; }
echo "$encoders" | grep -q ' aac ' || { echo "check-ffmpeg-lgpl: $ffmpeg has no aac encoder" >&2; failed=1; }
"$ffmpeg" -hide_banner -L | grep -qi 'lesser general public' || { echo "check-ffmpeg-lgpl: $ffmpeg does not report the LGPL" >&2; failed=1; }
[ "$failed" -eq 0 ] && echo "check-ffmpeg-lgpl: ok, $ffmpeg is LGPL with libopenh264"
exit "$failed"
