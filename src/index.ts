import dotenv from 'dotenv'
import http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { PuppeteerManager } from './services/PuppeteerManager'
import { LinkedInScraper } from './services/LinkedInScraper'
import { ProxyPoolManager } from './utils/ProxyPoolManager'
import { ProxyConfig } from './utils/ProxyManager'
import { CsvWriter } from './utils/CsvWriter'

// Load environment variables
dotenv.config()

function startHealthServer() {
    const port = Number(process.env.PORT) || 4000
    const server = http.createServer((req, res) => {
        if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/plain')
            res.end('linkedin-scraper server is running')
            return
        }

        res.statusCode = 404
        res.setHeader('Content-Type', 'text/plain')
        res.end('Not Found')
    })

    server.listen(port, () => {
        console.log(`🩺 Health server listening on port ${port}`)
    })
}

function loadProfileUrls(filePath: string): string[] {
    try {
        const fullPath = path.resolve(filePath)
        if (!fs.existsSync(fullPath)) {
            console.error(`❌ Profile file not found: ${fullPath}`)
            return []
        }

        const content = fs.readFileSync(fullPath, 'utf8')
        const urls = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line.startsWith('http'))

        console.log(`✅ Loaded ${urls.length} profile URLs from ${filePath}`)
        return urls
    } catch (error: any) {
        console.error(`❌ Error loading profile URLs: ${error.message}`)
        return []
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function getRandomDelay(): number {
    const min = Number(process.env.DELAY_MIN) || 5000
    const max = Number(process.env.DELAY_MAX) || 15000
    return Math.floor(Math.random() * (max - min + 1)) + min
}

async function main() {
    console.log('🚀 LinkedIn Scraper Starting...')
    console.log('='.repeat(50))

    // Validate environment variables
    const linkedinEmail = process.env.LINKEDIN_EMAIL
    const linkedinPassword = process.env.LINKEDIN_PASSWORD

    if (!linkedinEmail || !linkedinPassword) {
        console.error('❌ Missing LinkedIn credentials in .env file')
        console.error('Please set LINKEDIN_EMAIL and LINKEDIN_PASSWORD')
        process.exit(1)
    }

    // Load profile URLs
    const profilesFile = process.env.PROFILES_FILE || 'profiles.txt'
    const profileUrls = loadProfileUrls(profilesFile)

    if (profileUrls.length === 0) {
        console.error('❌ No profile URLs found')
        process.exit(1)
    }

    console.log(`📊 Will scrape ${profileUrls.length} profiles`)

    // Initialize Proxy Pool
    let apiProxy: ProxyConfig | undefined
    if (process.env.USE_PROXY === 'true' && process.env.PROXY_HOST) {
        apiProxy = {
            host: process.env.PROXY_HOST,
            port: Number(process.env.PROXY_PORT) || 12323,
            username: process.env.PROXY_USERNAME || '',
            password: process.env.PROXY_PASSWORD || '',
            protocol: 'http'
        }
        console.log(`🛡️ Using API proxy: ${apiProxy.host}:${apiProxy.port}`)
    }

    const proxyPool = new ProxyPoolManager('linkedin-scraper', apiProxy, 0)
    console.log(`✅ ProxyPoolManager initialized`)

    // Initialize PuppeteerManager
    const puppeteerManager = await PuppeteerManager.getInstance()
    puppeteerManager.setProxyPool(proxyPool)
    console.log(`✅ PuppeteerManager initialized`)

    // Initialize LinkedIn Scraper
    const scraper = new LinkedInScraper(puppeteerManager, proxyPool)
    console.log(`✅ LinkedInScraper initialized`)

    // Initialize CSV Writer
    const outputFile = process.env.OUTPUT_FILE || 'results.csv'
    const csvWriter = new CsvWriter(outputFile)
    console.log(`✅ CSV Writer initialized - output: ${outputFile}`)

    console.log('='.repeat(50))

    try {
        // Login to LinkedIn
        console.log('\n🔐 Logging into LinkedIn...')
        const loginSuccess = await scraper.login(linkedinEmail, linkedinPassword)

        if (!loginSuccess) {
            console.error('❌ Login failed - cannot proceed')
            process.exit(1)
        }

        console.log('✅ Login successful!')
        console.log('='.repeat(50))
        
        // Small delay after login before starting to scrape
        console.log('\n⏰ Waiting 3 seconds before starting to scrape...')
        await sleep(3000)

        // Scrape profiles
        console.log(`\n📊 Starting to scrape ${profileUrls.length} profiles...\n`)

        let successCount = 0
        let failCount = 0

        for (let i = 0; i < profileUrls.length; i++) {
            const profileUrl = profileUrls[i]
            const profileNumber = i + 1

            console.log(`\n[${profileNumber}/${profileUrls.length}] Scraping: ${profileUrl}`)
            console.log(`  ├─ Proxy: ${proxyPool.getCurrentProxyInfo()}`)

            try {
                // Scrape profile
                const profileData = await scraper.scrapeProfile(profileUrl)

                // Save to CSV
                await csvWriter.writeProfile(profileData)

                if (profileData.status === 'success') {
                    successCount++
                    console.log(`  ├─ Name: ${profileData.name}`)
                    console.log(`  ├─ Headline: ${profileData.headline.substring(0, 50)}${profileData.headline.length > 50 ? '...' : ''}`)
                    console.log(`  ├─ Location: ${profileData.location}`)
                    console.log(`  ├─ Experience: ${profileData.experience.length} items`)
                    console.log(`  ├─ Education: ${profileData.education.length} items`)
                    console.log(`  ├─ Skills: ${profileData.skills.length} items`)
                    console.log(`  ✅ Saved to CSV`)
                } else {
                    failCount++
                    console.log(`  ❌ Failed: ${profileData.error}`)
                }

                // Random delay before next profile
                if (i < profileUrls.length - 1) {
                    const delay = getRandomDelay()
                    const seconds = (delay / 1000).toFixed(1)
                    console.log(`  ⏰ Waiting ${seconds} seconds before next profile...`)
                    await sleep(delay)
                }

            } catch (error: any) {
                failCount++
                console.error(`  ❌ Error scraping profile: ${error.message}`)
                
                // Save failed profile to CSV
                await csvWriter.writeProfile({
                    url: profileUrl,
                    name: 'N/A',
                    headline: 'N/A',
                    location: 'N/A',
                    about: 'N/A',
                    experience: [],
                    education: [],
                    skills: [],
                    connectionsCount: 'N/A',
                    scrapedAt: new Date().toISOString(),
                    status: 'failed',
                    error: error.message,
                    proxyUsed: proxyPool.getCurrentProxyInfo()
                })
            }
        }

        // Summary
        console.log('\n' + '='.repeat(50))
        console.log('📊 SCRAPING SUMMARY')
        console.log('='.repeat(50))
        console.log(`✅ Successful: ${successCount}/${profileUrls.length}`)
        console.log(`❌ Failed: ${failCount}/${profileUrls.length}`)
        console.log(`📁 Results saved to: ${outputFile}`)
        console.log('='.repeat(50))

    } catch (error: any) {
        console.error(`\n❌ Fatal error: ${error.message}`)
        console.error(error.stack)
    } finally {
        // Cleanup
        console.log('\n🧹 Cleaning up...')
        await puppeteerManager.close()
        console.log('✅ Browser closed')
        console.log('👋 LinkedIn Scraper finished')
        process.exit(0)
    }
}

/**
 * Graceful shutdown handler
 */
async function performGracefulCleanup(reason: string = 'shutdown'): Promise<void> {
    console.log(`\n🧹 Performing graceful cleanup (${reason})...`)

    try {
        const manager = await PuppeteerManager.getInstance()
        await manager.close()
        console.log('✅ Puppeteer browser closed')
    } catch (error) {
        console.error('⚠️ Error closing Puppeteer:', error)
    }

    console.log('✅ Cleanup completed')
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...')
    await performGracefulCleanup('SIGINT')
    console.log('👋 LinkedIn Scraper stopped')
    process.exit(0)
})

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...')
    await performGracefulCleanup('SIGTERM')
    console.log('👋 LinkedIn Scraper stopped')
    process.exit(0)
})

// Start health server
startHealthServer()

// Start main process
main().catch(error => {
    console.error('💥 Fatal error in main:', error)
    process.exit(1)
})

