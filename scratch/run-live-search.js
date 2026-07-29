import PinterestScraper from '../pinterest-scraper.js';

async function runLiveSearch() {
  const query = "web ui, onboarding, sign in ui";
  console.log(`🚀 Searching Pinterest live for: "${query}"...\n`);

  const scraper = new PinterestScraper();
  const controller = new AbortController();

  const results = await scraper.search(query, 10, true, controller.signal);

  console.log(`✅ Successfully fetched ${results.length} live high-resolution Pinterest UI design pins:\n`);

  results.forEach((pin, index) => {
    console.log(`📌 Pin ${index + 1}: ${pin.title}`);
    console.log(`   High-Res Image: ${pin.image_url}`);
    console.log(`   Pin Page: ${pin.link}`);
    console.log(`   Source: ${pin.source}`);
    console.log(`----------------------------------------------------------------`);
  });
}

runLiveSearch().catch(console.error);
