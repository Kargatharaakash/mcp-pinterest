import PinterestScraper from '../pinterest-scraper.js';

async function runLiveSimilar() {
  const pinUrl = 'https://www.pinterest.com/pin/11822017768403505/';
  console.log(`🚀 Fetching deep visual design recommendations for Pin: ${pinUrl}...\n`);

  const scraper = new PinterestScraper();
  const results = await scraper.getSimilarPins(pinUrl, 10);

  console.log(`✅ Extracted ${results.length} related visual design recommendations:\n`);

  results.forEach((pin, index) => {
    console.log(`📌 Recommendation ${index + 1}: ${pin.title}`);
    console.log(`   High-Res Image: ${pin.image_url}`);
    console.log(`   Pin Link: ${pin.link}`);
    console.log(`----------------------------------------------------------------`);
  });
}

runLiveSimilar().catch(console.error);
