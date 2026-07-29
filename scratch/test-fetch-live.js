const query = "web ui, onboarding, sign in ui";
const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;

async function debugHtml() {
  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html"
    }
  });

  const html = await response.text();

  const regex = /(https?:[\\\/]+i\.pinimg\.com[\\\/]+[^\s"'>\\]+)/gi;
  const matches = [...html.matchAll(regex)].map(m => m[1]);

  console.log("Found i.pinimg.com matches:", matches.length);
  matches.slice(0, 15).forEach((m, i) => console.log(`${i + 1}. ${m}`));
}

debugHtml().catch(console.error);
