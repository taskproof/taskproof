# Gauntlet (working name)

Playwright + Lighthouse for the agent channel — an open-source CI harness that runs a matrix of real AI agents through defined tasks on your website, docs, or MCP server, scoring task completion, cost, and exact failure points, and diffing agent-usability across releases.

> Status: pre-release, pre-rename.

## Packages

| Package                                               | What it is                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`@gauntlet/spec`](packages/spec)                     | The task-spec format: versioned YAML schema with Zod validation. Start here.          |
| [`@gauntlet/cli`](packages/cli)                       | The `gauntlet` command. `validate` works; `init`/`run`/`report`/`baseline` are stubs. |
| [`@gauntlet/adapter-claude`](packages/adapter-claude) | Claude computer-use runner adapter (placeholder).                                     |

## Development

Requires Node ≥ 22 and pnpm 10.

```bash
pnpm install
pnpm build        # tsc, topological
pnpm test         # builds, then vitest across packages
pnpm lint         # eslint (type-checked)
pnpm format       # prettier

# try the CLI against the shipped example specs
node packages/cli/dist/index.js validate packages/spec/examples/*.yaml
```

Releases must use `pnpm publish` (never `npm publish`): internal deps are declared as
`workspace:^`, which only pnpm rewrites to a real semver range at pack time.

## License

[Apache-2.0](LICENSE) — chosen over MIT for the explicit patent grant, which matters if the
task-spec format becomes a standard others implement. The CLI, spec, adapters, graders, and report
generator are open forever.
