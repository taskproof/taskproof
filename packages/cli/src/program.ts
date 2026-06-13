import { createRequire } from 'node:module';

import * as clack from '@clack/prompts';
import { Command } from 'commander';

import { formatFileResult, validateFiles } from './validate.js';

// Resolves to packages/cli/package.json from both src/ (tests) and dist/ (published).
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

const NOT_IMPLEMENTED: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'run', description: 'Run task specs against a URL across a matrix of agent models' },
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
