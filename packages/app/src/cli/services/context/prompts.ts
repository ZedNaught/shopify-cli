import {LocalSource, RemoteSource} from './identifiers.js'
import {LocalRemoteSource} from './id-matching.js'
import {IdentifiersExtensions} from '../../models/app/identifiers.js'
import {DeploymentMode} from '../deploy/mode.js'
import {fetchActiveAppVersion} from '../dev/fetch.js'
import {
  InfoTableSection,
  renderAutocompletePrompt,
  renderConfirmationPrompt,
  renderInfo,
} from '@shopify/cli-kit/node/ui'

export async function matchConfirmationPrompt(local: LocalSource, remote: RemoteSource) {
  return renderConfirmationPrompt({
    message: `Match ${local.configuration.name} (local name) with ${remote.title} (name on Shopify Partners, ID: ${remote.id})?`,
    confirmationMessage: `Yes, that's right`,
    cancellationMessage: `No, cancel`,
  })
}

export async function selectRemoteSourcePrompt(
  localSource: LocalSource,
  remoteSourcesOfSameType: RemoteSource[],
  remoteIdField: 'id' | 'uuid',
): Promise<RemoteSource> {
  const remoteOptions = remoteSourcesOfSameType.map((remote) => ({
    label: `Match it to ${remote.title} (ID: ${remote.id} on Shopify Partners)`,
    value: remote[remoteIdField],
  }))
  remoteOptions.push({label: 'Create new extension', value: 'create'})
  const uuid = await renderAutocompletePrompt({
    message: `How would you like to deploy your "${localSource.configuration.name}"?`,
    choices: remoteOptions,
  })
  return remoteSourcesOfSameType.find((remote) => remote[remoteIdField] === uuid)!
}

interface SourceSummary {
  question: string
  identifiers: IdentifiersExtensions
  toCreate: LocalSource[]
  onlyRemote: RemoteSource[]
  dashboardOnly: RemoteSource[]
}

export async function deployConfirmationPrompt(
  {question, identifiers, toCreate, onlyRemote, dashboardOnly}: SourceSummary,
  deploymentMode: DeploymentMode,
  apiKey?: string,
  token?: string,
): Promise<boolean> {
  let infoTable: InfoTableSection[] = await buildUnifiedDeploymentInfoPrompt(
    apiKey!,
    token!,
    identifiers,
    toCreate,
    dashboardOnly,
    deploymentMode,
  )
  if (infoTable.length === 0) {
    infoTable = buildLegacyDeploymentInfoPrompt({identifiers, toCreate, onlyRemote, dashboardOnly})
  }

  if (infoTable.length === 0) {
    return true
  }

  const confirmationMessage = (() => {
    switch (deploymentMode) {
      case 'legacy':
        return 'Yes, deploy to push changes'
      case 'unified':
        return 'Yes, release this new version'
      case 'unified-skip-release':
        return 'Yes, create this new version'
    }
  })()

  return renderConfirmationPrompt({
    message: question,
    infoTable,
    confirmationMessage,
    cancellationMessage: 'No, cancel',
  })
}

function buildLegacyDeploymentInfoPrompt({
  identifiers,
  toCreate,
  onlyRemote,
  dashboardOnly,
}: Omit<SourceSummary, 'question'>) {
  const infoTable: InfoTableSection[] = []

  if (toCreate.length > 0) {
    infoTable.push({header: 'Add', items: toCreate.map((source) => source.localIdentifier)})
  }

  const toUpdate = Object.keys(identifiers)

  if (toUpdate.length > 0) {
    infoTable.push({header: 'Update', items: toUpdate})
  }

  if (dashboardOnly.length > 0) {
    infoTable.push({header: 'Included from\nPartner dashboard', items: dashboardOnly.map((source) => source.title)})
  }

  if (onlyRemote.length > 0) {
    infoTable.push({header: 'Missing locally', items: onlyRemote.map((source) => source.title)})
  }

  return infoTable
}

async function buildUnifiedDeploymentInfoPrompt(
  apiKey: string,
  token: string,
  localRegistration: IdentifiersExtensions,
  toCreate: LocalSource[],
  dashboardOnly: RemoteSource[],
  deploymentMode: DeploymentMode,
) {
  if (deploymentMode === 'legacy') return []

  const activeAppVersion = await fetchActiveAppVersion({token, apiKey})

  if (!activeAppVersion.app.activeAppVersion) return []

  const infoTable: InfoTableSection[] = []

  const nonDashboardActiveAppRegistrations = activeAppVersion.app.activeAppVersion.appModuleVersions.filter(
    (module) => module.specification.options.managementExperience !== 'dashboard',
  )

  const toCreateFinal = [
    ...new Set(
      Object.entries(localRegistration)
        .filter(
          (validLocalRegistration) =>
            !nonDashboardActiveAppRegistrations
              .map((remoteRegistration) => remoteRegistration.registrationUuid)
              .includes(validLocalRegistration[1]),
        )
        .map((source) => source[0])
        .concat(toCreate.map((source) => source.localIdentifier)),
    ),
  ]

  if (toCreateFinal.length > 0) {
    infoTable.push({header: 'Add', items: toCreateFinal.map((source) => source)})
  }

  const toUpdate = Object.entries(localRegistration).filter((validLocalRegistration) =>
    nonDashboardActiveAppRegistrations
      .map((remoteRegistration) => remoteRegistration.registrationUuid)
      .includes(validLocalRegistration[1]),
  )

  if (toUpdate.length > 0) {
    infoTable.push({header: 'Update', items: toUpdate.map((source) => source[0])})
  }

  const dashboardActiveAppRegistrations = activeAppVersion.app.activeAppVersion.appModuleVersions.filter(
    (module) => module.specification.options.managementExperience === 'dashboard',
  )
  if (dashboardOnly.length > 0) {
    infoTable.push({header: 'Included from\nPartner dashboard', items: dashboardOnly.map((source) => source.title)})
  }

  const onlyRemote = activeAppVersion.app.activeAppVersion.appModuleVersions
    .filter((module) => !Object.values(localRegistration).includes(module.registrationUuid))
    .map((module) => module.registrationTitle)
  if (onlyRemote.length > 0) {
    const missingLocallySection: InfoTableSection = {
      header: 'Removed',
      color: 'red',
      helperText: 'Will be removed for users when this version is released.',
      items: onlyRemote,
    }

    infoTable.push(missingLocallySection)
  }

  return infoTable
}

export async function extensionMigrationPrompt(toMigrate: LocalRemoteSource[]): Promise<boolean> {
  const migrationNames = toMigrate.map(({local}) => local.configuration.name).join(',')
  const allMigrationTypes = toMigrate.map(({remote}) => remote.type.toLocaleLowerCase())
  const uniqueMigrationTypes = allMigrationTypes.filter((type, i) => allMigrationTypes.indexOf(type) === i).join(',')

  renderInfo({
    headline: "Extension migrations can't be undone.",
    body: `Your ${migrationNames} configuration has been updated. Migrating gives you access to new features and won't impact the end user experience. All previous extension versions will reflect this change.`,
  })

  return renderConfirmationPrompt({
    message: `Migrate ${migrationNames}?`,
    confirmationMessage: `Yes, confirm migration from ${uniqueMigrationTypes}`,
    cancellationMessage: 'No, cancel',
  })
}
