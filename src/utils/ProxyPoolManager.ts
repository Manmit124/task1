import { ProxyConfig } from './ProxyManager'

/**
 * Proxy Pool Manager with Fallback System for LinkedIn Scraper
 *
 * Features:
 * 1. Uses API proxy first, then backup proxies
 * 2. Automatic rotation on failures
 * 3. Fallback to direct connection when all proxies fail
 * 4. Smart failure tracking per proxy
 */
export class ProxyPoolManager {
    private readonly proxies: ProxyConfig[]
    private currentIndex: number = 0
    private failureCount: number = 0
    private readonly maxFailures: number = 2 // Rotate after 2 failures
    private readonly accountUsername: string

    // Intelligent Fallback System
    private allProxiesFailed: boolean = false
    private proxyFailureTracker: Map<string, number> = new Map() // Track failures per proxy
    private readonly maxProxyFailures: number = 6 // Consider proxy "dead" after 6 failures

    constructor(accountUsername: string = '', apiProxy?: ProxyConfig, accountIndex: number = 0) {
        this.accountUsername = accountUsername

        // Build proxy pool: API proxy first (highest priority), then backups
        this.proxies = []

        // Add API proxy first if provided and valid
        if (apiProxy && this.isValidProxy(apiProxy)) {
            this.proxies.push(apiProxy)
            console.log(
                `🎯 Added API proxy for ${accountUsername}: ${apiProxy.host}:${apiProxy.port} (from config)`
            )
        }

        // Add backup proxy
        const backupProxies: ProxyConfig[] = [
            {
                host: '88.209.211.163',
                port: 12323,
                username: '14ad170abbc2b',
                password: '769a45c98e',
                protocol: 'http'
            }
        ]

        this.proxies.push(...backupProxies)

        // Round-Robin Assignment: Distribute starting positions across accounts
        if (apiProxy && this.isValidProxy(apiProxy)) {
            // If we have API proxy, always start with it (index 0)
            this.currentIndex = 0
            console.log(
                `🎯 Prioritizing API proxy for ${accountUsername} (Account #${accountIndex})`
            )
        } else {
            // Round-robin starting position for backup proxies based on account index
            this.currentIndex = accountIndex % this.proxies.length
            console.log(
                `🔄 Round-robin assignment for ${accountUsername} (Account #${accountIndex}): starting with backup proxy #${this.currentIndex + 1}`
            )
        }

        console.log(`🛡️ ProxyPoolManager initialized for ${accountUsername}`)
        console.log(
            `📊 Total proxies: ${this.proxies.length} (API: ${apiProxy ? 1 : 0}, Backup: ${backupProxies.length})`
        )

        const currentProxy = this.getCurrentProxy()
        const proxyType =
            this.currentIndex === 0 && apiProxy
                ? '🎯 API Config'
                : `🔄 Backup #${this.currentIndex + (apiProxy ? 0 : 1)}`
        console.log(`🎯 Starting with: ${currentProxy.host}:${currentProxy.port} (${proxyType})`)
    }

    /**
     * Get current proxy configuration
     */
    getCurrentProxy(): ProxyConfig {
        return this.proxies[this.currentIndex]
    }

    /**
     * Build proxy URL for current proxy
     */
    getProxyUrl(): string {
        const proxy = this.getCurrentProxy()
        return `${proxy.protocol}://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${proxy.host}:${proxy.port}`
    }

    /**
     * Call when request succeeds - reset failure count and proxy failures
     */
    onRequestSuccess(): void {
        if (this.failureCount > 0) {
            console.log(`✅ Request succeeded for ${this.accountUsername}, resetting failure count`)
            this.failureCount = 0
        }

        // Reset fallback state on success
        if (this.allProxiesFailed) {
            console.log(
                `🔄 Request succeeded with direct connection for ${this.accountUsername}, will retry proxies`
            )
            this.allProxiesFailed = false
            this.proxyFailureTracker.clear()
        }
    }

    /**
     * Call when request fails - increment failure count and rotate if needed
     */
    onRequestFailure(): void {
        this.failureCount++
        const proxy = this.getCurrentProxy()
        const proxyKey = `${proxy.host}:${proxy.port}`

        // Track failures for this specific proxy
        const proxyFailures = (this.proxyFailureTracker.get(proxyKey) || 0) + 1
        this.proxyFailureTracker.set(proxyKey, proxyFailures)

        console.log(
            `❌ Request failed ${this.failureCount}/${this.maxFailures} for ${this.accountUsername} on ${proxy.host}:${proxy.port} - total failures: ${proxyFailures}`
        )

        if (this.failureCount >= this.maxFailures) {
            // Check if all proxies have failed multiple times
            if (this.areAllProxiesFailed()) {
                console.log(
                    `🚨 All proxies failed for ${this.accountUsername}, switching to direct connection`
                )
                this.allProxiesFailed = true
            } else {
                this.rotateToNextProxy()
            }
            this.failureCount = 0
        }
    }

    /**
     * Get current proxy info for logging
     */
    getCurrentProxyInfo(): string {
        if (this.proxies.length === 0 || this.allProxiesFailed)
            return 'Direct connection'

        const proxy = this.getCurrentProxy()
        const isApiProxy = this.currentIndex === 0 && this.proxies.length > 1
        const proxyType = isApiProxy ? 'API' : 'Backup'
        return `${proxy.host}:${proxy.port} (${proxyType})`
    }

    /**
     * Check if we have any proxies available
     */
    hasProxies(): boolean {
        return this.proxies.length > 0
    }

    /**
     * Check if we should use proxy or direct connection
     */
    shouldUseProxy(): boolean {
        return this.hasProxies() && !this.allProxiesFailed
    }

    // ===== PRIVATE METHODS =====

    private rotateToNextProxy(): void {
        const oldProxy = this.getCurrentProxy()
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length
        const newProxy = this.getCurrentProxy()
        console.log(
            `🔄 Rotated proxy for ${this.accountUsername}: ${oldProxy.host}:${oldProxy.port} → ${newProxy.host}:${newProxy.port}`
        )
    }

    private isValidProxy(proxy: ProxyConfig): boolean {
        return !!(proxy.host && proxy.port && proxy.username && proxy.password && proxy.protocol)
    }

    /**
     * Check if all proxies have failed multiple times
     */
    private areAllProxiesFailed(): boolean {
        if (this.proxies.length === 0) return true

        return this.proxies.every(proxy => {
            const proxyKey = `${proxy.host}:${proxy.port}`
            const failures = this.proxyFailureTracker.get(proxyKey) || 0
            return failures >= this.maxProxyFailures
        })
    }
}

