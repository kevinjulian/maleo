# Task 3.5 production-reference build recovery

The initial failure occurred after task 3.4, at 14 of 36 tasks. At that point,
task 3.5 remained unchecked and no video references or support declarations
were accepted. The recovery below led to verified task 3.5 completion, at 15 of
36 tasks. Existing thresholds and earlier reference images remain unchanged.

Attempted on 2026-10-28:

```sh
docker build --platform linux/amd64 --target runtime -t maleo-golden:p2-media-playback .
```

The build included dependency patches before the frozen install. Cargo and apt
then failed with filesystem errors:

```text
error: failed to write to /src/target/release/deps/.../full.rmeta:
Read-only file system (os error 30)
Could not open file /var/cache/apt/archives/partial/...deb:
open (30: Read-only file system)
```

Subsequent `docker info` and `docker ps` both reported:

```text
Error response from daemon: Docker Desktop is unable to start
```

Host data filesystem showed 8.4 GiB available and 99 percent capacity. This does
not establish the cause of Docker's filesystem failure. The owned failed build
client was stopped; its final result was context cancellation, exit 130. No build
client remains running. No Docker restart, cleanup, volume deletion or deployment
was performed.

Docker must recover before producing the required production-image references.
On the next continuation, `docker info` timed out after 15 seconds and
`docker desktop status` timed out after 10 seconds. A bounded
`docker desktop start --timeout 20` returned `Docker Desktop is already running`.
The user then authorized restarting Docker Desktop. The bounded restart failed
after 45 seconds because Docker processes did not stop. The agent sent TERM to
the listed Docker processes, then KILL to the one backend that remained stuck.
`docker desktop start --timeout 45` succeeded. `docker info` returned daemon
version 29.8.1, and `docker ps` showed no running containers.

The production-image build resumed. Host space fell to 1.8 GiB during the build.
Removing this checkout's disposable `target/debug/incremental` cache (9.2 GiB)
restored 8 GiB available. No source, runtime database, Docker image, container,
or volume was deleted. Future native builds can take longer after cache removal.

The resumed production build completed successfully. Image ID:
`sha256:a83ea6dea45681c80a287330411b13b743f25d0a3788d85fa46497e875f5e762`.
All 54 candidate reference frames rendered in that image, and its emoji font
SHA-256 matched the existing corpus pin. Docker recovery is complete.

Seven video cases were staged under ignored `data/video-parity-corpus`. The
generator verifies every frame ID and exact presentation timestamp. A repeat
generation passed, with identical hashes for the movie and all 24 samples.
Before adding cases, the new native parity test failed with `video corpus is
required`, so an absent corpus cannot produce a false pass. Candidate cases and
references then entered the working corpus for verification. They are not yet
accepted: 16 of 54 frames failed parity or geometry. See `video-parity.md`.

The user approved production/source-frame alignment. The decoder, native host,
frame identities, specs and owning documentation now follow that decision.
All 67 candidate frames in nine cases pass unchanged SSIM thresholds; the two
geometry companions pass the original two-pixel gate. Direct/sequential and
reverse-order checks pass. See `video-parity.md` for refreshed proof. Existing
reference PNGs, export behavior and thresholds remain unchanged.

Final contributor gate `bun run check` passed: version/reference checks, full
static checks and all 12 workspace typechecks. Focused and browser results are in
`renderer-video.md`. Full CI and physical-device acceptance remain open.
