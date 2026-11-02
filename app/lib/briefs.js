// The four Christmas tree directions you chose. Each becomes a sweatshirt and a mug.
const BASE = 'Flat vector graphic for print-on-demand apparel. Clean crisp edges, solid flat colours, no gradients, no shadows, no texture, no mockup, no clothing, no frame, no background scene. Centered, isolated on a fully transparent background with generous empty space around the artwork.';

const DIRECTIONS = {
  gilded: {
    name: 'Gilded outline',
    text: 'EVERGREEN',
    palette: 'antique gold #C8A456 only',
    shirtColors: ['Forest Green', 'Forest', 'Dark Green', 'Military Green', 'Black'],
    mugBackground: '#1F3D2B',
    look: 'quiet, premium, minimalist',
    prompt: 'A minimalist Christmas tree emblem made of three stacked triangular tiers, each tier drawn as an elegant thin antique-gold (#C8A456) outline, the tiers overlapping like a stylised pine. A small four-pointed gold star on top and a short gold trunk. Beneath the tree, the single word "EVERGREEN" in small, widely letter-spaced uppercase geometric sans-serif, antique gold. Premium, understated, like a luxury gift label.'
  },
  tonal: {
    name: 'Tonal pines',
    text: "SEASON'S FINEST",
    palette: 'deep evergreen #1F3D2B, pine #2E5E43, sage #6E9475, cranberry #8E1B2E',
    shirtColors: ['Sand', 'Natural', 'Oatmeal', 'Cream', 'Ash', 'White'],
    mugBackground: '#E9E1D1',
    look: 'soft, modern, Scandinavian',
    prompt: 'A modern geometric Christmas tree made of three solid stacked triangles: the bottom tier deep evergreen (#1F3D2B), the middle tier pine green (#2E5E43), the top tier soft sage (#6E9475). A small cranberry red (#8E1B2E) dot as the star on top, and a tiny brown trunk. Beneath it, the words "SEASON\'S FINEST" in small, widely letter-spaced uppercase sans-serif, deep evergreen. Scandinavian, calm, modern.'
  },
  goldlines: {
    name: 'Gold lines',
    text: 'GOOD TIDINGS',
    palette: 'warm gold #D4B26A and cream #EDE6D6',
    shirtColors: ['Maroon', 'Cardinal Red', 'Cardinal', 'Garnet', 'Burgundy', 'Black'],
    mugBackground: '#7A1626',
    look: 'festive, elegant, art deco',
    prompt: 'A Christmas tree built entirely from nine horizontal warm-gold (#D4B26A) lines with rounded ends, each line wider than the one above, with small gaps that suggest three tiers of a pine tree. A small four-pointed gold star on top. Beneath it, the words "GOOD TIDINGS" in small, widely letter-spaced uppercase sans-serif, cream (#EDE6D6). Elegant, festive, art deco feel.'
  },
  split: {
    name: 'Split tiers',
    text: 'MERRY · MMXXVI',
    palette: 'emerald #2F7A55, berry red #B3263A, gold #D4B26A',
    shirtColors: ['Black', 'Charcoal', 'Dark Heather'],
    mugBackground: '#1E1E1E',
    look: 'bold, graphic, streetwear',
    prompt: 'A bold graphic Christmas tree made of three separate solid emerald green (#2F7A55) triangles stacked with clear gaps between them, each wider than the one above. A gold (#D4B26A) four-pointed star on top. A few tiny round berry-red (#B3263A) and gold baubles. Beneath it, the text "MERRY · MMXXVI" in small, widely letter-spaced uppercase sans-serif, gold. Streetwear, confident, graphic.'
  }
};

function designPrompt(key, product, feedback) {
  const d = DIRECTIONS[key];
  let p = `${d.prompt} ${BASE}`;
  if (product === 'mug') p += ' Compact composition that reads well small, on a mug.';
  if (feedback) p += ` Important fix from review: ${feedback}`;
  return p;
}

module.exports = { DIRECTIONS, designPrompt };
