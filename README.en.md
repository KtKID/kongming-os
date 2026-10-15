# kongming-os

Kongming uses the complete DeepSeek Harness backend, pinned as a Git submodule from its own fork. Kongming owns the launcher, profiles, application bundles, and business plugins.

The current Codex CLI and Web Bundle depend on the DSH `cli-tools` extension, which is absent from the pinned submodule commit. Complete installation, build, and launch verification require a DSH version containing that extension. The commands below describe the installation entry points once those dependencies are available.

Requires Git, Node.js `^22.19 || >=24`, and pnpm `11.7.0`.

```sh
git clone --recurse-submodules https://github.com/KtKID/kongming-os.git
cd kongming-os
pnpm install --frozen-lockfile
pnpm run setup
pnpm run build
pnpm run cli --help
pnpm run cli "Inspect this project"
pnpm web
```

`cli` launches the DSH one-shot headless application; `web` launches the DSH Web application; `sdk` launches its JSON-RPC application. Configure provider credentials through the environment or the ignored root `.env`; the official provider uses `DEEPSEEK_API_KEY`.

The complete backend lives under `third_party/dsh/`. Versioned Kongming profiles live under `profiles/`, and its application bundle lives under `bundles/kongming/`. Business plugins and the development-preset bundle live under `packages/`. The launcher registers profile links under `KMH_HOME`, with runtime state managed as described in [Runtime records](docs/kmh/runtime-records.md). Repeated registration preserves profile files and rejects conflicting directories.

`launch.config.json` selects the profile for each short command. The base Web configuration and four base presets live in `bundles/dsh-web/cordis.patch.yml`; the profile patch owns KMH plugins and deployment overrides, and the profile manifest selects bundles through `dsh.profile.bundles`. Edit deployment overrides in the profile patch: `webserver.config.port` defaults to `60000`, and `web-runtime.config.openBrowser` controls browser handoff. `pnpm config:web` prints the effective configuration. The original DSH Web configuration is preserved in `profiles/kmh-web/upstream.cordis.yml` for comparison and upgrade review.

Kongming client plugins contribute to DSH Web through their `./client` exports.

Read [the current architecture](docs/architecture/kongming-runtime.md), [the Web plugin index](docs/kmh/plugin-index.md), and [the integration guide](docs/kmh/README.md) for runtime ownership, configuration, and upgrades. Run `pnpm hooks` to install the current Node commit and push checks.
