import type { Page } from 'puppeteer'
import { logger } from '../utils/Logger'
import { PuppeteerManager } from './PuppeteerManager'
import { ProxyPoolManager } from '../utils/ProxyPoolManager'

export interface LinkedInProfile {
    url: string
    name: string
    headline: string
    location: string
    about: string
    experience: any[]
    education: any[]
    skills: string[]
    connectionsCount: string
    scrapedAt: string
    status: 'success' | 'failed'
    error?: string
    proxyUsed: string
}

export class LinkedInScraper {
    private puppeteerManager: PuppeteerManager
    private proxyPool: ProxyPoolManager
    private readonly username = 'linkedin-scraper'

    constructor(puppeteerManager: PuppeteerManager, proxyPool: ProxyPoolManager) {
        this.puppeteerManager = puppeteerManager
        this.proxyPool = proxyPool
    }

    async login(email: string, password: string): Promise<boolean> {
        logger.info(this.username, 'linkedin', 'Starting login process...')
        
        try {
            return await this.puppeteerManager.withPersistentPage(this.username, async (page) => {
                // Navigate to login page
                await page.goto('https://www.linkedin.com/login', { 
                    waitUntil: 'networkidle2',
                    timeout: 60000 
                })
                
                logger.info(this.username, 'linkedin', 'Login page loaded')
                
                await this.sleep(this.randomDelay(1000, 2000))
                
                await page.waitForSelector('#username', { timeout: 10000 })
                await page.waitForSelector('#password', { timeout: 10000 })
                
                await page.click('#username')
                await this.sleep(this.randomDelay(300, 600))
                
                await page.type('#username', email, { delay: this.randomDelay(80, 150) })
                
                await this.sleep(this.randomDelay(500, 1000))
                
                await page.click('#password')
                await this.sleep(this.randomDelay(300, 600))
                
                await page.type('#password', password, { delay: this.randomDelay(80, 150) })
                
                await this.sleep(this.randomDelay(800, 1500))
                
                logger.info(this.username, 'linkedin', 'Credentials entered, submitting...')
                
                await Promise.all([
                    page.click('button[type="submit"]'),
                    page.waitForNavigation({ 
                        waitUntil: 'networkidle2',
                        timeout: 30000 
                    }).catch(() => {
                        logger.info(this.username, 'linkedin', 'Checking login status...')
                    })
                ])
                
                await this.sleep(3000)
                
                const currentUrl = page.url()
                logger.info(this.username, 'linkedin', `Current URL: ${currentUrl}`)
                
                if (currentUrl.includes('/feed') || currentUrl.includes('/mynetwork') || currentUrl.includes('/in/')) {
                    logger.info(this.username, 'linkedin', '✅ Login successful')
                    this.proxyPool.onRequestSuccess()
                    return true
                } else if (currentUrl.includes('/checkpoint/challenge')) {
                    logger.warn(this.username, 'linkedin', '⚠️ Security challenge detected')
                    await page.waitForNavigation({ 
                        waitUntil: 'networkidle2',
                        timeout: 120000 
                    }).catch(() => {})
                    const newUrl = page.url()
                    if (newUrl.includes('/feed') || newUrl.includes('/mynetwork')) {
                        logger.info(this.username, 'linkedin', '✅ Login successful')
                        this.proxyPool.onRequestSuccess()
                        return true
                    }
                } else if (currentUrl.includes('/login')) {
                    const bodyText = await page.evaluate(() => document.body.innerText)
                    if (bodyText.includes('Sign out') || bodyText.includes('Feed')) {
                        logger.info(this.username, 'linkedin', '✅ Login successful')
                        this.proxyPool.onRequestSuccess()
                        return true
                    }
                }
                
                logger.error(this.username, 'linkedin', `❌ Login failed - current URL: ${currentUrl}`)
                this.proxyPool.onRequestFailure()
                return false
            })
        } catch (error: any) {
            logger.error(this.username, 'linkedin', `❌ Login error: ${error.message}`)
            this.proxyPool.onRequestFailure()
            return false
        }
    }

    async scrapeProfile(profileUrl: string): Promise<LinkedInProfile> {
        const result: LinkedInProfile = {
            url: profileUrl,
            name: '',
            headline: '',
            location: '',
            about: '',
            experience: [],
            education: [],
            skills: [],
            connectionsCount: '',
            scrapedAt: new Date().toISOString(),
            status: 'failed',
            proxyUsed: this.proxyPool.getCurrentProxyInfo()
        }

        try {
            logger.info(this.username, 'linkedin', `Scraping profile: ${profileUrl}`)
            
            await this.puppeteerManager.withPersistentPage(this.username, async (page) => {
                // Navigate to profile - use 'domcontentloaded' instead of 'networkidle2'
                // LinkedIn profiles have lots of lazy-loaded content, so networkidle2 times out
                await page.goto(profileUrl, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                })
                
                // Wait for main content to load
                await this.sleep(3000)
                
                // Human-like: Look at the page before scrolling
                await this.sleep(this.randomDelay(2000, 4000))
                
                // Scroll down to load lazy content (human-like)
                await this.scrollPage(page)
                
                // Human-like: Pause after scrolling to "read" content
                await this.sleep(this.randomDelay(1000, 2000))
                
                // Extract basic info (updated selectors based on actual LinkedIn HTML)
                result.name = await this.extractText(page, 'h1') || 'N/A'
                result.headline = await this.extractText(page, '.text-body-medium') || 'N/A'
                result.location = await this.extractText(page, '.text-body-small') || 'N/A'
                
                // Extract connections count
                result.connectionsCount = await this.extractText(page, '.pvs-entity__caption-wrapper') || 'N/A'
                
                // Extract About section
                result.about = await this.extractAbout(page)
                
                // Extract Experience
                result.experience = await this.extractExperience(page)
                
                // Extract Education
                result.education = await this.extractEducation(page)
                
                // Extract Skills
                result.skills = await this.extractSkills(page)
                
                result.status = 'success'
                logger.info(this.username, 'linkedin', `✅ Successfully scraped: ${result.name}`)
                this.proxyPool.onRequestSuccess()
            })
        } catch (error: any) {
            logger.error(this.username, 'linkedin', `❌ Scraping error: ${error.message}`)
            result.error = error.message
            this.proxyPool.onRequestFailure()
        }

        return result
    }

    private async scrollPage(page: Page): Promise<void> {
        try {
            // Human-like scrolling: variable speed and distance
            await page.evaluate(async () => {
                await new Promise<void>((resolve) => {
                    let totalHeight = 0
                    let scrollCount = 0
                    const maxScrolls = 15 // Don't scroll forever
                    
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight
                        
                        // Variable scroll distance (200-400px)
                        const distance = Math.floor(Math.random() * 200) + 200
                        window.scrollBy(0, distance)
                        totalHeight += distance
                        scrollCount++

                        // Human-like: Sometimes pause while scrolling
                        if (scrollCount % 3 === 0) {
                            clearInterval(timer)
                            setTimeout(() => {
                                // Resume scrolling after pause
                                if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
                                    resolve()
                                }
                            }, Math.random() * 500 + 300)
                        }

                        if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
                            clearInterval(timer)
                            resolve()
                        }
                    }, Math.random() * 200 + 250) // Variable scroll speed (250-450ms)
                })
            })
            
            // Human-like: Pause after scrolling
            await this.sleep(this.randomDelay(800, 1500))
        } catch (error) {
            logger.warn(this.username, 'linkedin', 'Scroll failed, continuing anyway')
        }
    }

    private async extractText(page: Page, selector: string): Promise<string> {
        try {
            const element = await page.$(selector)
            if (element) {
                const text = await page.evaluate(el => el.textContent?.trim() || '', element)
                return text
            }
        } catch (error) {
            // Ignore
        }
        return ''
    }

    private async extractAbout(page: Page): Promise<string> {
        try {
            const about = await page.evaluate(() => {
                const aboutSection = document.querySelector('#about')
                if (!aboutSection) return ''
                
                // Look for the about text in the next sibling or parent container
                const container = aboutSection.parentElement
                if (!container) return ''
                
                // Find all spans with aria-hidden in the about section
                const spans = Array.from(container.querySelectorAll('span[aria-hidden="true"]'))
                for (const span of spans) {
                    const text = span.textContent?.trim()
                    if (text && text.length > 20 && !text.includes('About')) {
                        return text
                    }
                }
                
                return ''
            })
            return about || 'N/A'
        } catch (error) {
            return 'N/A'
        }
    }

    private async extractExperience(page: Page): Promise<any[]> {
        try {
            const experiences = await page.evaluate(() => {
                const items: any[] = []
                const experienceSection = document.querySelector('#experience')
                if (!experienceSection) return items
                
                // Find all experience entries
                const experienceList = experienceSection.parentElement?.querySelectorAll('li')
                if (!experienceList) return items
                
                experienceList.forEach((item) => {
                    // Title is in .t-bold or first span with aria-hidden
                    const titleEl = item.querySelector('.t-bold span[aria-hidden="true"]') || 
                                   item.querySelector('.hoverable-link-text span[aria-hidden="true"]')
                    const title = titleEl?.textContent?.trim()
                    
                    // Company is in .t-14.t-normal
                    const companyEl = item.querySelector('.t-14.t-normal span[aria-hidden="true"]')
                    const company = companyEl?.textContent?.trim()
                    
                    // Duration is in .pvs-entity__caption-wrapper
                    const durationEl = item.querySelector('.pvs-entity__caption-wrapper')
                    const duration = durationEl?.textContent?.trim()
                    
                    if (title || company) {
                        items.push({ title, company, duration })
                    }
                })
                
                return items
            })
            return experiences
        } catch (error) {
            return []
        }
    }

    private async extractEducation(page: Page): Promise<any[]> {
        try {
            const education = await page.evaluate(() => {
                const items: any[] = []
                const educationSection = document.querySelector('#education')
                if (!educationSection) return items
                
                const educationList = educationSection.parentElement?.querySelectorAll('li')
                if (!educationList) return items
                
                educationList.forEach((item) => {
                    // School name
                    const schoolEl = item.querySelector('.t-bold span[aria-hidden="true"]') ||
                                    item.querySelector('.hoverable-link-text span[aria-hidden="true"]')
                    const school = schoolEl?.textContent?.trim()
                    
                    // Degree
                    const degreeEl = item.querySelector('.t-14.t-normal span[aria-hidden="true"]')
                    const degree = degreeEl?.textContent?.trim()
                    
                    // Years
                    const yearsEl = item.querySelector('.pvs-entity__caption-wrapper')
                    const years = yearsEl?.textContent?.trim()
                    
                    if (school || degree) {
                        items.push({ school, degree, years })
                    }
                })
                
                return items
            })
            return education
        } catch (error) {
            return []
        }
    }

    private async extractSkills(page: Page): Promise<string[]> {
        try {
            const skills = await page.evaluate(() => {
                const skillsList: string[] = []
                const skillsSection = document.querySelector('#skills')
                if (!skillsSection) return skillsList
                
                const skillElements = skillsSection.parentElement?.querySelectorAll('span[aria-hidden="true"]')
                if (!skillElements) return skillsList
                
                skillElements.forEach((skill) => {
                    const text = skill.textContent?.trim()
                    if (text && text.length > 1 && text.length < 50) {
                        skillsList.push(text)
                    }
                })
                
                return skillsList.slice(0, 20) // Limit to 20 skills
            })
            return skills
        } catch (error) {
            return []
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    private randomDelay(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min
    }
}

