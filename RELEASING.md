# Releasing

taskproof publishes eight packages from this monorepo to npm, **versioned in lockstep**. While
pre-release (`0.x`), cut a release when the harness gains real capability — nothing is
auto-published.

## One-time setup

- `npm login` as the account that owns the `taskproof` name and the `@taskproof` scope.
- The scoped packages carry `publishConfig.access: "public"`, so they publish publicly without a
  `--access` flag. The unscoped `taskproof` is public by default.

## Cutting a release

1. **Green `main`.** From a clean checkout with passing CI:

   ```bash
   pnpm install && pnpm build && pnpm -r run test && pnpm lint && pnpm format:check && pnpm -r run typecheck
   # Python sidecar:
   (cd packages/adapter-browser-use/sidecar && uv run ruff check . && uv run ruff format --check . && uv run pytest -q)
   ```

2. **Bump in lockstep** (no git tag yet — that comes after publishing):

   ```bash
   pnpm -r exec npm version <new-version> --no-git-tag-version
   # or edit each package's "version" by hand — they all move together
   ```

3. **Update `CHANGELOG.md`** — move items from `[Unreleased]` into a new dated `[<version>]`
   section.

4. **Commit:** `git commit -am "Release v<version>"`

5. **Rehearse (always).** Confirm the eight tarballs resolve each other, publish _public_, and go
   out in dependency order:

   ```bash
   pnpm -r publish --dry-run --no-git-checks
   ```

   Expect the scoped packages to report **public access** and `taskproof` to be published **last**
   (it depends on all the others). Each package's `prepack` hook rebuilds its `dist/` first
   (`dist/` is gitignored), so the dry-run packs exactly what a real publish would — a faithful
   rehearsal, not a check against a possibly-stale build.

6. **Publish** (interactive — npm 2FA / WebAuthn prompts per package):

   ```bash
   pnpm -r publish
   ```

   Use **`pnpm`**, not `npm publish`: pnpm rewrites the `workspace:^` dependencies to real version
   ranges at pack time and publishes in topological order (dependencies before the CLI). A CLI
   published ahead of its dependencies would 404 on install. Each package's `prepack` hook
   (`tsc -p tsconfig.build.json`) rebuilds `dist/` immediately before packing, so a stale or
   missing build can never be published — but step 1's full build + test gate is still the place
   you catch problems _before_ this irreversible step.

7. **Tag and push:**

   ```bash
   git tag v<version> && git push origin main --tags
   ```

8. _(Optional)_ Cut a GitHub Release from the tag, pasting the CHANGELOG section.

## Notes

- **Irreversible.** You can't reuse a version you've unpublished, and the first publish of each
  name is permanent. The dry-run in step 5 is the safety net — run it every time.
- **Lockstep, for now.** All packages share one version. If they later need independent
  versioning, adopt [Changesets](https://github.com/changesets/changesets) — overkill while the
  set moves together.
