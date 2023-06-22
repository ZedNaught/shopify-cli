import {ExtensionsPayloadStore} from './payload/store.js'
import {ExtensionDevOptions} from '../extension.js'
import {bundleExtension} from '../../extensions/bundle.js'

import {AppInterface} from '../../../models/app/app.js'
import {updateExtensionConfig, updateExtensionDraft} from '../update-extension.js'
import {buildFunctionExtension} from '../../../services/build/extension.js'
import {ExtensionInstance} from '../../../models/extensions/extension-instance.js'
import {ExtensionSpecification} from '../../../models/extensions/specification.js'
import {FunctionConfigType} from '../../../models/extensions/specifications/function.js'
import {AbortController, AbortSignal} from '@shopify/cli-kit/node/abort'
import {joinPath} from '@shopify/cli-kit/node/path'
import {outputDebug, outputInfo, outputWarn} from '@shopify/cli-kit/node/output'
import {Writable} from 'stream'

export interface WatchEvent {
  path: string
  type: 'build' | 'localization'
}

export interface FileWatcherOptions {
  devOptions: ExtensionDevOptions
  payloadStore: ExtensionsPayloadStore
}

export interface FileWatcher {
  close: () => void
}

export async function setupBundlerAndFileWatcher(options: FileWatcherOptions) {
  const {default: chokidar} = await import('chokidar')
  const abortController = new AbortController()

  const bundlers: Promise<void>[] = []

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  options.devOptions.extensions.forEach(async (extension) => {
    bundlers.push(
      bundleExtension({
        minify: false,
        outputPath: extension.outputPath,
        environment: 'development',
        env: {
          ...(options.devOptions.app.dotenv?.variables ?? {}),
          APP_URL: options.devOptions.url,
        },
        stdin: {
          contents: extension.getBundleExtensionStdinContent(),
          resolveDir: extension.directory,
          loader: 'tsx',
        },
        stderr: options.devOptions.stderr,
        stdout: options.devOptions.stdout,
        watchSignal: abortController.signal,
        watch: async (result) => {
          const error = (result?.errors?.length ?? 0) > 0
          outputDebug(
            `The Javascript bundle of the UI extension with ID ${extension.devUUID} has ${
              error ? 'an error' : 'changed'
            }`,
            error ? options.devOptions.stderr : options.devOptions.stdout,
          )

          try {
            await options.payloadStore.updateExtension(extension, options.devOptions, {
              status: error ? 'error' : 'success',
            })
            // eslint-disable-next-line no-catch-all/no-catch-all
          } catch {
            // ESBuild handles error output
          }
        },
      }),
    )

    const localeWatcher = chokidar
      .watch(joinPath(extension.directory, 'locales', '**.json'))
      .on('change', (_event, path) => {
        outputDebug(`Locale file at path ${path} changed`, options.devOptions.stdout)
        options.payloadStore
          .updateExtension(extension, options.devOptions)
          .then((_closed) => {
            outputDebug(`Notified extension ${extension.devUUID} about the locale change.`, options.devOptions.stdout)
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .catch((_: any) => {})
      })

    abortController.signal.addEventListener('abort', () => {
      outputDebug(`Closing locale file watching for extension with ID ${extension.devUUID}`, options.devOptions.stdout)
      localeWatcher
        .close()
        .then(() => {
          outputDebug(`Locale file watching closed for extension with ${extension.devUUID}`, options.devOptions.stdout)
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .catch((error: any) => {
          outputDebug(
            `Locale file watching failed to close for extension with ${extension.devUUID}: ${error.message}`,
            options.devOptions.stderr,
          )
        })
    })
  })

  await Promise.all(bundlers)

  return {
    close: () => {
      abortController.abort()
    },
  }
}

interface SetupDraftableExtensionBundlerOptions {
  extension: ExtensionInstance
  app: AppInterface
  url: string
  token: string
  apiKey: string
  registrationId: string
  stderr: Writable
  stdout: Writable
  signal: AbortSignal
  unifiedDeployment: boolean
}

export async function setupDraftableExtensionBundler({
  extension,
  app,
  url,
  token,
  apiKey,
  registrationId,
  stderr,
  stdout,
  signal,
  unifiedDeployment,
}: SetupDraftableExtensionBundlerOptions) {
  return bundleExtension({
    minify: false,
    outputPath: extension.outputPath,
    environment: 'development',
    env: {
      ...(app.dotenv?.variables ?? {}),
      APP_URL: url,
    },
    stdin: {
      contents: extension.getBundleExtensionStdinContent(),
      resolveDir: extension.directory,
      loader: 'tsx',
    },
    stderr,
    stdout,
    watchSignal: signal,

    watch: async (result) => {
      const error = (result?.errors?.length ?? 0) > 0
      outputInfo(
        `The Javascript bundle of the extension with ID ${extension.devUUID} has ${error ? 'an error' : 'changed'}`,
        error ? stderr : stdout,
      )
      if (error) return

      await updateExtensionDraft({extension, token, apiKey, registrationId, stderr, unifiedDeployment})
    },
  })
}

interface SetupConfigWatcherOptions {
  extension: ExtensionInstance
  token: string
  apiKey: string
  registrationId: string
  stdout: Writable
  stderr: Writable
  signal: AbortSignal
  specifications: ExtensionSpecification[]
  unifiedDeployment: boolean
}

export async function setupConfigWatcher({
  extension,
  token,
  apiKey,
  registrationId,
  stdout,
  stderr,
  signal,
  specifications,
  unifiedDeployment,
}: SetupConfigWatcherOptions) {
  const {default: chokidar} = await import('chokidar')

  const configWatcher = chokidar.watch(extension.configurationPath).on('change', (_event, _path) => {
    outputInfo(`Config file at path ${extension.configurationPath} changed`, stdout)
    updateExtensionConfig({extension, token, apiKey, registrationId, stderr, specifications, unifiedDeployment}).catch(
      (_: unknown) => {},
    )
  })

  signal.addEventListener('abort', () => {
    outputDebug(`Closing config file watching for extension with ID ${extension.devUUID}`, stdout)
    configWatcher
      .close()
      .then(() => {
        outputDebug(`Config file watching closed for extension with ${extension.devUUID}`, stdout)
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .catch((error: any) => {
        outputDebug(
          `Config file watching failed to close for extension with ${extension.devUUID}: ${error.message}`,
          stderr,
        )
      })
  })
}

export interface SetupFunctionWatcherOptions {
  extension: ExtensionInstance
  app: AppInterface
  stdout: Writable
  stderr: Writable
  signal: AbortSignal
  token: string
  apiKey: string
  registrationId: string
  unifiedDeployment: boolean
}

export async function setupFunctionWatcher({
  extension,
  app,
  stdout,
  stderr,
  signal,
  token,
  apiKey,
  registrationId,
  unifiedDeployment,
}: SetupFunctionWatcherOptions) {
  const {default: chokidar} = await import('chokidar')

  outputDebug(`Starting watcher for function extension ${extension.devUUID}`, stdout)
  const watchPaths = getFunctionWatchPaths(extension as ExtensionInstance<FunctionConfigType>)
  if (!watchPaths) {
    outputWarn(
      `Function extension ${extension.localIdentifier} does not have a watch path configured, draft version deployment is disabled.`,
      stdout,
    )
    return
  }

  outputDebug(`Watching paths for function extension ${extension.localIdentifier}: ${watchPaths}`, stdout)
  let buildController: AbortController | null

  const functionWatcher = chokidar.watch(watchPaths).on('change', (path) => {
    outputDebug(`Function extension file at path ${path} changed`, stdout)
    if (buildController) {
      // terminate any existing builds
      buildController.abort()
    }
    buildController = new AbortController()
    const buildSignal = buildController.signal
    buildFunctionExtension(extension, {
      app,
      stdout,
      stderr,
      useTasks: false,
      signal: buildSignal,
    })
      .then(() => {
        if (!buildSignal.aborted) {
          return updateExtensionDraft({extension, token, apiKey, registrationId, stderr, unifiedDeployment})
        }
      })
      .catch((updateError: unknown) => {
        outputWarn(`Error while deploying updated extension draft: ${JSON.stringify(updateError, null, 2)}`, stdout)
      })
      .finally(() => {
        buildController = null
      })
  })

  signal.addEventListener('abort', () => {
    outputDebug(`Closing function file watching for extension with ID ${extension.devUUID}`, stdout)
    functionWatcher
      .close()
      .then(() => {
        outputDebug(`Function file watching closed for extension with ${extension.devUUID}`, stdout)
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .catch((error: any) => {
        outputDebug(
          `Function file watching failed to close for extension with ${extension.devUUID}: ${error.message}`,
          stderr,
        )
      })
  })
}

export function getFunctionWatchPaths(extension: ExtensionInstance<FunctionConfigType>) {
  if (!extension.isJavaScript && extension.watchPaths.length === 0) {
    return null
  }

  const watchPaths: string[] = extension.watchPaths ?? []
  if (extension.isJavaScript && watchPaths.length === 0) {
    watchPaths.push(joinPath('src', '**', '*.js'))
    watchPaths.push(joinPath('src', '**', '*.ts'))
  }
  watchPaths.push(joinPath('**', 'input*.graphql'))

  return watchPaths.map((path) => joinPath(extension.directory, path))
}
