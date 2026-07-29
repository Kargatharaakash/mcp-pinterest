async function testSearchResource() {
  const start = performance.now();
  const query = "modern dashboard ui";
  const dataParam = JSON.stringify({
    options: {
      query: query,
      scope: "pins"
    },
    context: {}
  });

  const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}`;
  const apiUrl = `https://www.pinterest.com/resource/SearchResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(dataParam)}`;

  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      "X-Pinterest-AppState": "active",
      "Accept": "application/json"
    }
  });

  const text = await response.text();
  const end = performance.now();
  console.log(`SearchResource Response status: ${response.status}, time: ${(end - start).toFixed(2)} ms`);
  console.log("Text length:", text.length);
  if (text.startsWith("{")) {
    const json = JSON.parse(text);
    const results = json.resource_response?.data?.results || [];
    console.log(`Extracted ${results.length} pins from SearchResource!`);
    if (results.length > 0) {
      console.log("Sample pin title:", results[0].title || results[0].grid_title || results[0].snippet);
      console.log("Sample image:", results[0].images?.orig?.url || results[0].images?.["736x"]?.url);
    }
  } else {
    console.log("Response snippet:", text.substring(0, 200));
  }
}

testSearchResource().catch(console.error);
