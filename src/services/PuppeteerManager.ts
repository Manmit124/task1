import type { Browser, BrowserContext, Page } from 'puppeteer'
import { logger } from '../utils/Logger'
import { ProxyPoolManager } from '../utils/ProxyPoolManager'

class PuppeteerManager {
    private static instance: PuppeteerManager | null = null
    private browser: Browser | null = null
    private usernameToContext = new Map<string, BrowserContext>()
    private usernameToPersistentPage = new Map<string, Page>()
    private static readonly VIEWPORT = { width: 1024, height: 768 }
    private proxyPoolManager: ProxyPoolManager | null = null

    private static async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    private constructor() {}

    static async getInstance(): Promise<PuppeteerManager> {
        if (!this.instance) {
            this.instance = new PuppeteerManager()
            await this.instance.init()
        }
        return this.instance
    }

    setProxyPool(proxyPoolManager: ProxyPoolManager): void {
        this.proxyPoolManager = proxyPoolManager
        logger.info('SYSTEM', 'puppeteer', 'ProxyPoolManager configured')
    }

    private async init(): Promise<void> {
        if (this.browser) return
        logger.info('SYSTEM', 'puppeteer', 'Launching single shared Chrome instance')
        const path = await import('node:path')
        const projectRoot = path.resolve(__dirname, '..', '..')
        const runtimeCacheDir =
            process.env.PUPPETEER_CACHE_DIR || path.join(projectRoot, '.cache', 'puppeteer')
        process.env.PUPPETEER_CACHE_DIR = runtimeCacheDir
        const puppeteer = (await import('puppeteer')).default
        const resolvedExecutablePath =
            process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath()
        const headlessEnv = process.env.PUPPETEER_HEADLESS
        const headless = headlessEnv ? /^(1|true|yes)$/i.test(headlessEnv) : true

        const protocolTimeoutMs = Number(process.env.PUPPETEER_PROTOCOL_TIMEOUT || '') || 180_000
        const launchTimeoutMs = Number(process.env.PUPPETEER_LAUNCH_TIMEOUT || '') || 30_000
        const launchAttempts = Number(process.env.PUPPETEER_LAUNCH_ATTEMPTS || '') || 5

        let lastError: any = null
        for (let attempt = 1; attempt <= launchAttempts; attempt++) {
            try {
                logger.info(
                    'SYSTEM',
                    'puppeteer',
                    `Starting Chrome (attempt ${attempt}/${launchAttempts})`
                )

                const args = [
                    `--window-size=${PuppeteerManager.VIEWPORT.width},${PuppeteerManager.VIEWPORT.height}`,
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-features=UseOzonePlatform',
                    '--use-gl=swiftshader'
                ]

                // Add proxy args if proxy is configured
                if (this.proxyPoolManager?.shouldUseProxy()) {
                    const proxyUrl = this.proxyPoolManager.getProxyUrl()
                    args.push(`--proxy-server=${proxyUrl}`)
                    logger.info(
                        'SYSTEM',
                        'puppeteer',
                        `Using proxy: ${this.proxyPoolManager.getCurrentProxyInfo()}`
                    )
                }

                const browser = await puppeteer.launch({
                    headless,
                    defaultViewport: PuppeteerManager.VIEWPORT,
                    executablePath: resolvedExecutablePath,
                    protocolTimeout: protocolTimeoutMs,
                    timeout: launchTimeoutMs,
                    args
                })

                // Short delay to let Chrome settle before creating first target
                await PuppeteerManager.sleep(1000)

                // Smoke test: ensure we can create a page/target
                try {
                    const page = await browser.newPage()
                    try {
                        await page.close()
                    } catch {}
                } catch (pageErr) {
                    try {
                        await browser.close()
                    } catch {}
                    throw pageErr
                }

                this.browser = browser
                logger.info('SYSTEM', 'puppeteer', 'Chrome started successfully')
                break
            } catch (err: any) {
                lastError = err
                logger.warn(
                    'SYSTEM',
                    'puppeteer',
                    `Error when starting Chrome: ${err?.message || err}.` +
                        (attempt < launchAttempts
                            ? ' Will retry after short delay.'
                            : ' No attempts left.')
                )
                try {
                    if (this.browser) {
                        await this.browser.close()
                    }
                } catch {}
                this.browser = null
                if (attempt < launchAttempts) {
                    await PuppeteerManager.sleep(1000)
                }
            }
        }

        if (!this.browser) {
            throw new Error(
                `Failed to launch Chrome after ${launchAttempts} attempts: ${lastError?.message || lastError}`
            )
        }
    }

    async getContextFor(username: string): Promise<BrowserContext> {
        if (!this.browser) await this.init()
        const existing = this.usernameToContext.get(username)
        if (existing) return existing
        const ctx = await this.browser!.createBrowserContext()
        this.usernameToContext.set(username, ctx)
        logger.debug(username, 'puppeteer', 'Created incognito context for account')
        return ctx
    }

    async withPage<T>(username: string, run: (page: Page) => Promise<T>): Promise<T> {
        const ctx = await this.getContextFor(username)
        const page = await ctx.newPage()
        try {
            await page.setViewport(PuppeteerManager.VIEWPORT)
        } catch {}
        try {
            const defaultPageTimeoutMs = Number(process.env.PUPPETEER_PAGE_TIMEOUT || '') || 60000
            page.setDefaultTimeout(defaultPageTimeoutMs)
            page.setDefaultNavigationTimeout(defaultPageTimeoutMs)
        } catch {}
        try {
            return await run(page)
        } finally {
            try {
                await page.close()
            } catch {}
        }
    }

    async getPersistentPage(username: string): Promise<Page> {
        const ctx = await this.getContextFor(username)
        const existing = this.usernameToPersistentPage.get(username)

        // Check if existing page is valid and not in error state
        if (existing && !existing.isClosed()) {
            try {
                const currentUrl = existing.url()
                // If page is in error state, recreate it
                if (
                    currentUrl.startsWith('chrome-error://') ||
                    currentUrl.startsWith('chrome://')
                ) {
                    logger.warn(
                        username,
                        'puppeteer',
                        `Page in error state (${currentUrl}), recreating...`
                    )
                    await this.closePersistentPage(username)
                } else {
                    return existing
                }
            } catch (error: any) {
                logger.warn(
                    username,
                    'puppeteer',
                    `Error checking existing page: ${error?.message || error}, recreating...`
                )
                await this.closePersistentPage(username)
            }
        }

        const page = await ctx.newPage()
        try {
            await page.setViewport(PuppeteerManager.VIEWPORT)
        } catch {}
        try {
            const defaultPageTimeoutMs = Number(process.env.PUPPETEER_PAGE_TIMEOUT || '') || 60000
            page.setDefaultTimeout(defaultPageTimeoutMs)
            page.setDefaultNavigationTimeout(defaultPageTimeoutMs)
        } catch {}
        this.usernameToPersistentPage.set(username, page)
        return page
    }

    async withPersistentPage<T>(username: string, run: (page: Page) => Promise<T>): Promise<T> {
        let page = await this.getPersistentPage(username)
        try {
            return await run(page)
        } catch (error: any) {
            if (PuppeteerManager.isLikelySessionClosedError(error)) {
                logger.warn(
                    username,
                    'puppeteer',
                    'Detected session/target closed. Resetting persistent page and retrying once.'
                )
                await this.closePersistentPage(username)
                page = await this.getPersistentPage(username)
                return await run(page)
            }
            throw error
        }
    }

    async closePersistentPage(username: string): Promise<void> {
        const page = this.usernameToPersistentPage.get(username)
        if (page && !page.isClosed()) {
            try {
                await page.close()
            } catch {}
        }
        this.usernameToPersistentPage.delete(username)
    }

    async resetForUsername(username: string): Promise<void> {
        try {
            await this.closePersistentPage(username)
        } catch {}
        const ctx = this.usernameToContext.get(username)
        if (ctx) {
            try {
                await ctx.close()
            } catch {}
            this.usernameToContext.delete(username)
        }
        logger.info(username, 'puppeteer', 'Reset account context and persistent page')
    }

    async forceResetPage(username: string): Promise<void> {
        logger.warn(username, 'puppeteer', 'Force resetting page due to error state')
        await this.resetForUsername(username)
    }

    static isLikelySessionClosedError(error: any): boolean {
        const msg = String(error?.message || error || '').toLowerCase()
        return (
            msg.includes('session closed') ||
            msg.includes('target closed') ||
            msg.includes('execution context was destroyed') ||
            msg.includes('most likely the page has been closed') ||
            msg.includes('cannot find context with specified id')
        )
    }

    static isLikelyBrowserDisconnectedError(error: any): boolean {
        const msg = String(error?.message || error || '').toLowerCase()
        return (
            msg.includes('browser has disconnected') ||
            msg.includes('connection closed') ||
            msg.includes('websocket is not open') ||
            msg.includes('navigation failed because browser has disconnected')
        )
    }

    async relaunchBrowser(): Promise<void> {
        logger.warn('SYSTEM', 'puppeteer', 'Relaunching Chrome browser due to disconnection/crash')
        await this.close()
        await this.init()
    }

    async close(): Promise<void> {
        try {
            // Attempt to close persistent pages first
            for (const [username, page] of this.usernameToPersistentPage.entries()) {
                try {
                    if (!page.isClosed()) await page.close()
                } catch {}
                this.usernameToPersistentPage.delete(username)
            }
            for (const ctx of this.usernameToContext.values()) {
                try {
                    await ctx.close()
                } catch {}
            }
            this.usernameToContext.clear()
            await this.browser?.close()
        } catch (e: any) {
            logger.error('SYSTEM', 'puppeteer', `Error closing browser: ${e?.message || e}`)
        } finally {
            this.browser = null
        }
    }
}

export { PuppeteerManager }

