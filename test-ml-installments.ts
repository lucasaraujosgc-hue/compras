function extractMLInstallments(html: string) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    const scriptContent = $('#__NORDIC_RENDERING_CTX__').html() || '';
    const jsonMatch = scriptContent.match(/_n\.ctx\.r\s*=\s*(.*);?/);
    if (!jsonMatch) return null;

    try {
        const jsonStr = jsonMatch[1].trim().replace(/;$/, '');
        const data = JSON.parse(jsonStr);
        const priceObj = data?.appProps?.pageProps?.initialState?.price || {};
        
        console.log("Installment info:", JSON.stringify(priceObj, null, 2));
    } catch (e) {
    }
}
