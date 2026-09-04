import * as cheerio from 'cheerio';
import fs from 'fs';

async function test() {
  const response = await fetch("https://produto.mercadolivre.com.br/MLB-4863089069");
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const scriptContent = $('#__NORDIC_RENDERING_CTX__').html();
  if (!scriptContent) {
    console.log("Script not found");
    return;
  }
  
  const jsonMatch = scriptContent.match(/_n\.ctx\.r\s*=\s*(.*);?/);
  if (!jsonMatch) {
    console.log("JSON not matched");
    return;
  }
  
  try {
    const jsonStr = jsonMatch[1].trim().replace(/;$/, '');
    const data = JSON.parse(jsonStr);
    const initialState = data.appProps?.pageProps?.initialState;
    
    if (initialState) {
        console.log("Title:", initialState.header?.title || initialState.seo?.title);
        console.log("Price:", initialState.price?.price?.value);
        
        const gallery = initialState.gallery;
        if (gallery && gallery.picture_config && gallery.pictures && gallery.pictures.length > 0) {
            const template = gallery.picture_config.template_zoom;
            const pic = gallery.pictures[0];
            const url = template.replace('{id}', pic.id).replace('{sanitizedTitle}', pic.sanitized_title);
            console.log("Image URL:", url);
        }
    } else {
        console.log("initialState not found");
    }
  } catch(e) {
    console.error(e);
  }
}
test();
