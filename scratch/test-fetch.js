const query = "cyberpunk city";
const url = "https://www.pinterest.com/search/pins/?q=" + encodeURIComponent(query);

async function inspectHtml() {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  const html = await res.text();
  const index = html.indexOf("i.pinimg.com");
  console.log("i.pinimg.com index:", index);
  if (index !== -1) {
    console.log("Context snippet:", html.substring(index - 50, index + 150));
  }
}

inspectHtml().catch(console.error);
