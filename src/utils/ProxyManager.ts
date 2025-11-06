import { HttpsProxyAgent } from 'https-proxy-agent'
import { HttpProxyAgent } from 'http-proxy-agent'

export interface ProxyConfig {
    host: string
    port: number
    username: string
    password: string
    protocol: 'http' | 'https'
}

/**
 * Proxy manager for a specific account with its proxy configuration.
 * Creates and manages proxy agents for HTTP/HTTPS requests.
 */
export class ProxyManager {
    private readonly config: ProxyConfig
    private httpsAgent: any | null = null
    private httpAgent: any | null = null

    constructor(config: ProxyConfig) {
        this.config = config
    }

    private getProxyUrl(): string {
        const { protocol, username, password, host, port } = this.config
        return `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`
    }

    private ensureAgents(): void {
        if (this.httpsAgent && this.httpAgent) return
        const proxyUrl = this.getProxyUrl()
        this.httpsAgent = new HttpsProxyAgent(proxyUrl)
        this.httpAgent = new HttpProxyAgent(proxyUrl)
        console.log(`🛡️ Proxy agents ready for ${this.config.host}:${this.config.port}`)
    }

    getAgents(): { httpAgent: any; httpsAgent: any } {
        this.ensureAgents()
        return {
            httpAgent: this.httpAgent,
            httpsAgent: this.httpsAgent
        }
    }
}

