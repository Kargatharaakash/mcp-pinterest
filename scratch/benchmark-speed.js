import PinterestScraper from '../pinterest-scraper.js';

async function runBenchmark() {
  console.log('⚡ Starting Ultra-Fast Latency Benchmark...\n');
  const scraper = new PinterestScraper();

  // Test 1: Cold Search Query (Fast-Path HTTP Fetch)
  const t1 = performance.now();
  const res1 = await scraper.search('modern dashboard ui', 5);
  const t2 = performance.now();
  console.log(`🚀 1. Cold Search Query Latency: ${(t2 - t1).toFixed(2)} ms (Fetched ${res1.length} pins)`);

  // Test 2: Cached Search Query (Instant LRU Cache Hit)
  const t3 = performance.now();
  const res2 = await scraper.search('modern dashboard ui', 5);
  const t4 = performance.now();
  console.log(`⚡ 2. Cached Query Latency: ${(t4 - t3).toFixed(2)} ms (Fetched ${res2.length} pins)`);

  // Test 3: Parallel Multi-Query Execution (AI sending 3 queries simultaneously)
  console.log('\n🔥 3. Running 3 Parallel Queries Simultaneously (Promise.all)...');
  const queries = ['mobile onboarding ui', 'sign in dark mode ui', 'checkout flow ui'];
  const t5 = performance.now();
  const parallelResults = await Promise.all(queries.map(q => scraper.search(q, 5)));
  const t6 = performance.now();

  console.log(`💥 All 3 Parallel Queries Completed in Total: ${(t6 - t5).toFixed(2)} ms!`);
  parallelResults.forEach((results, idx) => {
    console.log(`   - Query "${queries[idx]}": ${results.length} pins returned`);
  });
}

runBenchmark().catch(console.error);
