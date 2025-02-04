import chalk from 'chalk';
import { spawn } from 'child_process';
import { join } from 'path';
import * as killProcess from 'tree-kill';
import { Input } from '../commands';
import { getValueOrDefault } from '../lib/compiler/helpers/get-value-or-default';
import { Configuration } from '../lib/configuration';
import { ERROR_PREFIX } from '../lib/ui';
import { BuildAction } from './build.action';

export class TestAction extends BuildAction {
  public async handle(inputs: Input[], options: Input[]) {
    try {
      const configuration = await this.loader.load();
      const appName = inputs.find(input => input.name === 'app')!
        .value as string;

      const pathToTsconfig = getValueOrDefault<string>(
        configuration,
        'compilerOptions.tsConfigPath',
        appName,
        'path',
        options,
      );

      const debugModeOption = options.find(option => option.name === 'debug');
      const debugFlag = debugModeOption && debugModeOption.value;

      const { options: tsOptions } = this.tsConfigProvider.getByConfigFilename(
        pathToTsconfig,
      );
      const outDir = getValueOrDefault(configuration, 'root', appName);

      const onSuccess = this.createOnSuccessHook(
        configuration,
        appName,
        debugFlag,
        outDir,
      );

      await this.runBuild(
        inputs,
        options,
        false,
        !!debugFlag,
        onSuccess,
      );
    } catch (err) {
      if (err instanceof Error) {
        console.log(`\n${ERROR_PREFIX} ${err.message}\n`);
      } else {
        console.error(`\n${chalk.red(err)}\n`);
      }
    }
  }

  public createOnSuccessHook(
    configuration: Required<Configuration>,
    appName: string,
    debugFlag: boolean | string | undefined,
    outDirName: string,
  ) {
    const testRoot = getValueOrDefault(configuration, 'testRoot', appName);

    let childProcessRef: any;
    process.on(
      'exit',
      code => childProcessRef && killProcess(childProcessRef.pid),
    );

    return () => {
      if (childProcessRef) {
        childProcessRef.removeAllListeners('exit');
        childProcessRef.on('exit', () => {
          childProcessRef = this.spawnChildProcess(
            testRoot,
            debugFlag,
            outDirName,
          );
          childProcessRef.on('exit', () => (childProcessRef = undefined));
        });

        childProcessRef.stdin && childProcessRef.stdin.pause();
        killProcess(childProcessRef.pid);
      } else {
        childProcessRef = this.spawnChildProcess(
          testRoot,
          debugFlag,
          outDirName,
        );
        childProcessRef.on('exit', () => (childProcessRef = undefined));
      }
    };
  }

  private spawnChildProcess(
    testRoot: string,
    debug: boolean | string | undefined,
    outDirName: string,
  ) {
    let outputFilePath = join(outDirName, testRoot);
    let childProcessArgs: string[] = [];
    const argsStartIndex = process.argv.indexOf('--');
    if (argsStartIndex >= 0) {
      childProcessArgs = process.argv.slice(argsStartIndex + 1);
    }
    outputFilePath =
      outputFilePath.indexOf(' ') >= 0 ? `"${outputFilePath}"` : outputFilePath;

    const processArgs = [outputFilePath, ...childProcessArgs];
    if (debug) {
      const inspectFlag =
        typeof debug === 'string' ? `--inspect=${debug}` : '--inspect';
      processArgs.unshift(inspectFlag);
    }

    return spawn('jest', processArgs, {
      stdio: 'inherit',
      shell: true,
    });
  }
}
