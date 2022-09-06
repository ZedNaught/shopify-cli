import {content, token, debug} from './output.js'
import constants from './constants.js'
import Conf, {Schema} from 'conf'

const migrations = {}

export interface CachedAppInfo {
  directory: string
  appId?: string
  title?: string
  orgId?: string
  storeFqdn?: string
  updateURLs?: boolean
}

interface ConfSchema {
  appInfo: CachedAppInfo[]
  themeStore: string
  session: string
}

const schema = {
  appInfo: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
        },
        orgId: {
          type: 'string',
        },
        storeFqdn: {
          type: 'string',
        },
      },
    },
  },
} as unknown as Schema<ConfSchema>

let _instance: CLIKitStore | undefined

export async function cliKitStore() {
  if (!_instance) {
    // eslint-disable-next-line require-atomic-updates
    _instance = new CLIKitStore({
      schema,
      migrations,
      projectName: 'shopify-cli-kit',
      projectVersion: await constants.versions.cliKit(),
    })
  }
  return _instance
}

export async function getAppInfo(directory: string): Promise<CachedAppInfo | undefined> {
  const store = await cliKitStore()
  return store.getAppInfo(directory)
}

export async function setAppInfo(options: {
  directory: string
  appId?: string
  title?: string
  storeFqdn?: string
  orgId?: string
  updateURLs?: boolean
}): Promise<void> {
  const store = await cliKitStore()
  store.setAppInfo(options)
}

export async function clearAppInfo(directory: string): Promise<void> {
  const store = await cliKitStore()
  store.clearAppInfo(directory)
}

export async function getTheme(): Promise<string | undefined> {
  const store = await cliKitStore()
  return store.getTheme()
}

export async function setTheme(theme: string): Promise<void> {
  const store = await cliKitStore()
  store.setTheme(theme)
}

export async function getSession(): Promise<string | undefined> {
  const store = await cliKitStore()
  return store.getSession()
}

export async function setSession(session: string): Promise<void> {
  const store = await cliKitStore()
  store.setSession(session)
}

export async function removeSession(): Promise<void> {
  const store = await cliKitStore()
  store.removeSession()
}

export class CLIKitStore extends Conf<ConfSchema> {
  getAppInfo(directory: string): CachedAppInfo | undefined {
    debug(content`Reading cached app information for directory ${token.path(directory)}...`)
    const apps = this.get('appInfo') ?? []
    return apps.find((app: CachedAppInfo) => app.directory === directory)
  }

  setAppInfo(options: {
    directory: string
    appId?: string
    title?: string
    storeFqdn?: string
    orgId?: string
    updateURLs?: boolean
  }): void {
    debug(content`Storing app information for directory ${token.path(options.directory)}:${token.json(options)}`)
    const apps = this.get('appInfo') ?? []
    const index = apps.findIndex((saved: CachedAppInfo) => saved.directory === options.directory)
    if (index === -1) {
      apps.push(options)
    } else {
      const app: CachedAppInfo = apps[index]!
      apps[index] = {
        directory: options.directory,
        appId: options.appId ?? app.appId,
        title: options.title ?? app.title,
        storeFqdn: options.storeFqdn ?? app.storeFqdn,
        orgId: options.orgId ?? app.orgId,
        updateURLs: options.updateURLs ?? app.updateURLs,
      }
    }
    this.set('appInfo', apps)
  }

  clearAppInfo(directory: string): void {
    debug(content`Clearning app information for directory ${token.path(directory)}...`)
    const apps = this.get('appInfo') ?? []
    const index = apps.findIndex((saved: CachedAppInfo) => saved.directory === directory)
    if (index !== -1) {
      apps.splice(index, 1)
    }
    this.set('appInfo', apps)
  }

  getTheme(): string | undefined {
    debug(content`Getting theme store...`)
    return this.get('themeStore')
  }

  setTheme(theme: string): void {
    debug(content`Setting theme store...`)
    this.set('themeStore', theme)
  }

  getSession(): string | undefined {
    debug(content`Getting session store...`)
    return this.get('sessionStore')
  }

  setSession(session: string): void {
    debug(content`Setting session store...`)
    this.set('sessionStore', session)
  }

  removeSession(): void {
    debug(content`Removing session store...`)
    this.set('sessionStore', '')
  }
}
