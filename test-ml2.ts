function extractMercadoLivre(html: string) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    const scriptContent = $('#__NORDIC_RENDERING_CTX__').html() || '';
    const jsonMatch = scriptContent.match(/_n\.ctx\.r\s*=\s*(.*);?/);
    if (!jsonMatch) return null;

    try {
        const jsonStr = jsonMatch[1].trim().replace(/;$/, '');
        const data = JSON.parse(jsonStr);
        const initialState = data?.appProps?.pageProps?.initialState;
        if (!initialState) return null;

        const name = initialState.header?.title || initialState.seo?.title;
        const price = initialState.price?.price?.value;
        let imageUrl = '';

        const gallery = initialState.gallery;
        if (gallery?.picture_config?.template_zoom && gallery?.pictures?.length > 0) {
            const template = gallery.picture_config.template_zoom;
            const pic = gallery.pictures[0];
            imageUrl = template.replace('{id}', pic.id).replace('{sanitizedTitle}', pic.sanitized_title);
        }

        if (name && price !== undefined) {
            return { name, price, imageUrl };
        }
    } catch (e) {
        console.error("ML Extract error", e);
    }
    return null;
}
console.log("Syntax OK");
