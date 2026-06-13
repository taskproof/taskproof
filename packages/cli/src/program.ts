import { createRequire } from 'node:module';

import * as clack from '@clack/prompts';
import { Command } from 'commander';

import { formatFileResult, validateFiles } from './validate.js';

// Resolves to packages/cli/package.json from both src/ (tests) and dist/ (published).
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

const NOT_IMPLEMENTED: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'report', description: 'Render the latest run as an HTML report' },
  { name: 'baseline', description: 'Save or compare agent-usability baselines' },
];

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('taskproof')
    .description(
      'Run a matrix of real AI agents through defined tasks on your site and report exactly where they fail.',
    )
    .version(pkg.version);

  program
    .command('validate')
    .description('Validate task-spec YAML files against the spec schema')
    .argument('<files...>', 'task spec files (e.g. taskproof/tasks/*.yaml)')
    .action(async (files: string[]) => {
      const results = await validateFiles(files);
      for (const result of results) {
        process.stdout.write(`${formatFileResult(result)}\n`);
      }
      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) {
        process.stderr.write(`\n${failed} of ${results.length} spec(s) invalid\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('run')
    .description('Run task specs across a matrix of agent models and grade them with pass@k')
    .argument('<files...>', 'task spec YAML files')
    .option('--models <list>', 'comma-separated model ids', 'claude-opus-4-8')
    .option('--out <dir>', 'directory for run artifacts', 'taskproof-runs')
    .option('--max-cost <usd>', 'hard per-run budget cap in USD', parseFloat)
    .option('-k, --runs <n>', 'override the spec pass@k k', (value) => Number.parseInt(value, 10))
    .option('--headed', 'run with a visible browser (default headless)')
    .action(
      async (
        files: string[],
        opts: { models: string; out: string; maxCost?: number; runs?: number; headed?: boolean },
      ) => {
        const models = opts.models
          .split(',')
          .map((model) => model.trim())
          .filter((model) => model !== '');
        if (models.length === 0) {
          process.stderr.write('no models specified\n');
          process.exitCode = 1;
          return;
        }
        // Lazy import: keeps Playwright/Anthropic out of the `validate`-only path.
        const { runSpecs, formatReport } = await import('./run.js');
        try {
          const report = await runSpecs(
            files,
            {
              models,
              outDir: opts.out,
              headed: opts.headed === true,
              ...(opts.maxCost !== undefined ? { maxCostUsd: opts.maxCost } : {}),
              ...(opts.runs !== undefined ? { k: opts.runs } : {}),
            },
            (message) => process.stderr.write(`${message}\n`),
          );
          process.stdout.write(`${formatReport(report)}\n`);
          if (!report.allPassed) process.exitCode = 1;
        } catch (error) {
          process.stderr.write(
            `run failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
          process.exitCode = 1;
        }
      },
    );

  program
    .command('init')
    .description('Detect your framework and scaffold starter task specs (not implemented yet)')
    .action(() => {
      clack.intro('taskproof init');
      clack.log.warn('Not implemented yet — this is an early scaffold.');
      clack.outro('Coming soon');
      process.exitCode = 1;
    });

  for (const { name, description } of NOT_IMPLEMENTED) {
    program
      .command(name)
      .description(`${description} (not implemented yet)`)
      .allowUnknownOption(true)
      .allowExcessArguments(true)
      .action(() => {
        process.stderr.write(`taskproof ${name} is not implemented yet (early scaffold).\n`);
        process.exitCode = 1;
      });
  }

  return program;
}
