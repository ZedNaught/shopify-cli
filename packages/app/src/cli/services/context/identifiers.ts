import {ensureExtensionsIds} from './identifiers-extensions.js'
import {AppInterface} from '../../models/app/app.js'
import {Identifiers} from '../../models/app/identifiers.js'
import {fetchAppExtensionRegistrations} from '../dev/fetch.js'
import {MinimalOrganizationApp} from '../../models/organization.js'
import {getRemoteAppConfig} from '../app/config/link.js'
import {DiffContent, buildDiffConfigContent} from '../../prompts/config.js'
import {PackageManager} from '@shopify/cli-kit/node/node-package-manager'
import {AbortError, AbortSilentError} from '@shopify/cli-kit/node/error'
import {outputContent, outputToken} from '@shopify/cli-kit/node/output'

export type PartnersAppForIdentifierMatching = MinimalOrganizationApp

export interface EnsureDeploymentIdsPresenceOptions {
  app: AppInterface
  token: string
  appId: string
  appName: string
  envIdentifiers: Partial<Identifiers>
  force: boolean
  release: boolean
  partnersApp: PartnersAppForIdentifierMatching
  diffConfigContent?: DiffContent
}

export interface RemoteSource {
  uuid: string
  type: string
  id: string
  title: string
  draftVersion?: {config: string}
}

export interface LocalSource {
  localIdentifier: string
  graphQLType: string
  type: string
  handle: string
}

export type MatchingError = 'pending-remote' | 'invalid-environment' | 'user-cancelled'

export async function ensureDeploymentIdsPresence(options: EnsureDeploymentIdsPresenceOptions) {
  const {remoteExtensions, diffConfigContent} = await fetchAndBuildDiffConfigContent(
    options.token,
    options.appId,
    options.app,
    options.partnersApp,
  )

  return (await ensureExtensionsIds({...options, diffConfigContent}, remoteExtensions))
    .mapError((error) => handleIdsError(error, options.appName, options.app.packageManager))
    .map((extensions) => {
      return {
        app: options.appId,
        extensions: extensions.extensions,
        extensionIds: extensions.extensionIds,
      }
    })
    .valueOrAbort()
}

async function fetchAndBuildDiffConfigContent(
  token: string,
  apiKey: string,
  app: AppInterface,
  remoteApp: PartnersAppForIdentifierMatching,
) {
  const remoteSpecifications = await fetchAppExtensionRegistrations({token, apiKey})

  const remoteConfig = getRemoteAppConfig(
    remoteSpecifications.app.configExtensionRegistrations,
    app.specifications.configSpecifications,
    remoteApp,
  )

  const localConfig = app.configuration
  return {
    remoteExtensions: remoteSpecifications.app,
    diffConfigContent: buildDiffConfigContent(localConfig, remoteConfig, app.configSchema),
  }
}

function handleIdsError(errorType: MatchingError, appName: string, packageManager: PackageManager) {
  switch (errorType) {
    case 'pending-remote':
    case 'invalid-environment':
      throw new AbortError(
        `Deployment failed because this local project doesn't seem to match the app "${appName}" in Shopify Partners.`,
        `If you didn't intend to select this app, run ${
          outputContent`${outputToken.packagejsonScript(packageManager, 'deploy', '--reset')}`.value
        }
• If this is the app you intended, check your local project and make sure
  it contains the same number and types of extensions as the Shopify app
  you've selected. You may need to generate missing extensions.`,
      )
    case 'user-cancelled':
      throw new AbortSilentError()
  }
}
