# LinkedIn Profile Scraper

LinkedIn profile scraper with Puppeteer, TypeScript, proxy support, and human-like behavior.

## Features

✅ Scrapes 20 LinkedIn profiles (name, headline, location, about, experience, education, skills, connections)
✅ Proxy rotation (API proxy + 6 backup proxies)
✅ Human-like delays and behavior (variable typing, scrolling, pauses)
✅ CSV output format
✅ Graceful error handling
✅ Health check server

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create .env file
cp env.example .env

# 3. Edit .env and add your LinkedIn credentials
# LINKEDIN_EMAIL=your-email@example.com
# LINKEDIN_PASSWORD=your-password

# 4. Run the scraper
npm run dev
```

## Human-Like Behavior

- Variable typing speed (80-150ms per character)
- Click fields before typing
- Pauses between actions (300-2000ms)
- Variable scroll speed and distance
- Random delays between profiles (5-15 seconds)
- Natural page load waits (2-4 seconds)

## Output

Results saved to `results.csv` with columns:
URL, Name, Headline, Location, About, Experience, Education, Skills, ConnectionsCount, ScrapedAt, Status, ProxyUsed, Error

## Configuration

All settings in `.env`:
- `LINKEDIN_EMAIL` - Your LinkedIn email (required)
- `LINKEDIN_PASSWORD` - Your LinkedIn password (required)
- `PUPPETEER_HEADLESS` - Show browser (false) or hide (true)
- `DELAY_MIN` / `DELAY_MAX` - Delay between profiles (ms)
- `USE_PROXY` - Enable/disable proxy

## Important Notes

⚠️ Scraping LinkedIn violates their Terms of Service. Use responsibly.
⚠️ LinkedIn may ban accounts that scrape aggressively.
⚠️ Set `PUPPETEER_HEADLESS=false` to see the browser (recommended for first run).

## Health Check

```bash
curl http://localhost:4000/health
```

## License

MIT

