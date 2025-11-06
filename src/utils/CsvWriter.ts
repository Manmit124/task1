import * as fs from 'fs'
import * as path from 'path'
import type { LinkedInProfile } from '../services/LinkedInScraper'

export class CsvWriter {
    private filePath: string
    private headerWritten: boolean = false

    constructor(filePath: string) {
        this.filePath = filePath
        
        // Check if file exists
        if (fs.existsSync(filePath)) {
            this.headerWritten = true
        }
    }

    async writeProfile(profile: LinkedInProfile): Promise<void> {
        // Write header if not written yet
        if (!this.headerWritten) {
            const header = 'URL,Name,Headline,Location,About,Experience,Education,Skills,ConnectionsCount,ScrapedAt,Status,ProxyUsed,Error\n'
            fs.writeFileSync(this.filePath, header, 'utf8')
            this.headerWritten = true
        }

        // Prepare CSV row
        const row = [
            this.escapeCsv(profile.url),
            this.escapeCsv(profile.name),
            this.escapeCsv(profile.headline),
            this.escapeCsv(profile.location),
            this.escapeCsv(profile.about),
            this.escapeCsv(JSON.stringify(profile.experience)),
            this.escapeCsv(JSON.stringify(profile.education)),
            this.escapeCsv(JSON.stringify(profile.skills)),
            this.escapeCsv(profile.connectionsCount),
            this.escapeCsv(profile.scrapedAt),
            this.escapeCsv(profile.status),
            this.escapeCsv(profile.proxyUsed),
            this.escapeCsv(profile.error || '')
        ].join(',')

        // Append to file
        fs.appendFileSync(this.filePath, row + '\n', 'utf8')
    }

    private escapeCsv(value: string): string {
        if (!value) return '""'
        
        // Escape quotes and wrap in quotes
        const escaped = value.replace(/"/g, '""')
        return `"${escaped}"`
    }
}

