// The prompts for ad images. The product is locked to the real photo; the ad's angle sets the scene; the brand palette
// sets the environment; the top and bottom of the frame stay calm so the headline and price can be set there.
// Prompt engineering is the quality lever here, so the wording is kept explicit and checkable.

const hex = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : null);

export function scenePrompt({ product = {}, variant = {}, brand = {}, palette = {} }) {
  const name = String(product.name || 'the product').slice(0, 120);
  const brandName = String(brand.name || 'the brand').slice(0, 60);
  const colours = [['primary', hex(palette.primary)], ['background', hex(palette.background)], ['text', hex(palette.text)]].filter(([, c]) => c).map(([n, c]) => `${n} ${c}`).join(', ');
  const tone = String(brand.tone_of_voice || 'confident, warm').slice(0, 120);
  const direction = String(variant.creative_direction || 'a clean, believable everyday moment with the product').slice(0, 400);
  return [
    'Create one square (1:1) professional advertising photograph for an Instagram and Facebook feed.',
    'FRAME: the scene fills the whole square edge to edge. No letterboxing, no borders, no bands of plain colour at the top or bottom, no black bars, no frame.',
    '',
    `HERO PRODUCT: the reference image is the real product "${name}" by ${brandName}.`,
    '- Show this exact product, complete and upright, tack-sharp, as the clear hero of the frame (about 40 to 50 percent of the frame height).',
    '- Keep its shape, colours, packaging, label, logo and every printed word EXACTLY as in the reference. Do not redraw, restyle, re-letter, mirror or alter the product in any way. Do not add a second product.',
    '',
    `SCENE for the angle "${variant.angle || 'lifestyle'}": ${direction}`,
    '- Props and surfaces must suit a skincare and body-care brand, and the product sits on a real surface with a believable contact shadow.',
    colours ? `- Environment colours from the brand palette: ${colours}. Use them for the backdrop, surfaces and props.` : '',
    `- Mood: ${tone}. Soft, directional, natural light; realistic colour grading; no harsh flash.`,
    '- Camera: 85 mm look, f/2.8 to f/4, shallow depth of field on the background, product in focus.',
    '',
    'COMPOSITION FOR TEXT: keep the top 22 percent of the frame a calm, uncluttered part of the backdrop (a headline goes there) and the bottom 16 percent calm too (price and button go there). No faces; hands only if they help the story.',
    '',
    'NEVER: added text, letters, numbers, logos, watermarks, prices, stickers, badges or any other brand anywhere in the image, except the product\'s own printed text. No CGI or plastic look, no oversaturation, no objects that compete with the product.',
  ].filter(x => x !== '').join('\n');
}

// Studio prompts (AI studio): a short idea from the user becomes a full brief, with the product locked when a photo is given.
export function studioPrompt({ idea = '', reference = false, palette = {}, aspect = '1:1' }) {
  const colours = [['primary', hex(palette.primary)], ['background', hex(palette.background)]].filter(([, c]) => c).map(([n, c]) => `${n} ${c}`).join(', ');
  return [
    String(idea || '').trim() || 'A premium product photograph',
    reference ? 'The reference image is the real product: keep its shape, colours, packaging, label and every printed word exactly as it is, and do not add a second product.' : '',
    colours ? `Use the brand colours for the environment: ${colours}.` : '',
    (aspect === '1:1' ? 'Square frame (1:1)' : 'Frame ' + aspect) + ', the scene filling it edge to edge with no borders, bands, panels or colour swatches.' + ' ' + ' Professional photograph: soft, natural light, realistic colour, sharp focus on the product, uncluttered background. No added text, letters, logos, watermarks or prices.',
  ].filter(Boolean).join(' ');
}
