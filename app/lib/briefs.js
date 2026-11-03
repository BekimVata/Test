// Banians creative direction (from Bekim, 3 Nov 2026):
// cosmic aesthetics + futuristic design + mysterious symbolism + bold minimalist streetwear.
// Christmas reimagined through a futuristic lens. Central motif: three geometric triangles forming a tree.
// Palette: deep midnight blue, rich navy, cosmic black, brilliant white, subtle celestial highlights.

// The Banians brand, year-round. Collections change with the seasons; the identity doesn't.
const BRAND = 'Banians is a year-round UK clothing brand whose designs blend cosmic wonder (stars, constellations, galaxies, the unknown) with the beauty of nature, in bold, minimal, premium artwork people are proud to wear. It is for everyone: never describe it as for men, women or any one group. New collections arrive through the year (Christmas now, then Halloween, Valentine\'s Day and everyday pieces), so never describe Banians as a Christmas shop.';

const PALETTE = 'brilliant white, ice blue (#A9C6D9) and pale silver, with tiny touches of soft violet starlight (#B8A9E8)';

// Colourways (added 3 Nov). Each one is a garment colour plus a print palette that suits it.
// The same design idea is made fresh in each colourway, and each becomes its own Etsy listing.
//   colors: Printify colour names to try, in order. hex: used for the preview the eagle checks.
const COLOURWAYS = {
  navy: {
    name: 'Midnight', garment: 'dark navy', hex: '#14213D', colors: ['Navy', 'Black', 'Dark Heather'], titleColour: 'Navy',
    ink: 'brilliant white', palette: PALETTE, finish: 'flat solid colours suitable for screen printing, no gradients that band', light: false
  },
  pine: {
    name: 'Pine & Starlight', garment: 'deep forest green', hex: '#243B2E', colors: ['Forest Green', 'Forest', 'Bottle Green', 'Military Green'], titleColour: 'Forest Green',
    ink: 'warm ivory', palette: 'warm ivory (#F3EBD8) and soft brushed gold (#C9A86A), with tiny touches of pale sage (#B9C8B0)',
    finish: 'flat solid colours suitable for screen printing, no gradients that band', light: false
  },
  aurora: {
    name: 'Aurora', garment: 'black', hex: '#111111', colors: ['Black'], titleColour: 'Black',
    ink: 'brilliant white', palette: 'a northern-lights glow flowing from teal (#2EC4B6) through violet (#7B5CD6) to soft pink (#F2A7C3), with brilliant white highlights',
    finish: 'smooth, clean aurora gradients that print well (no banding, no noise), everything else in flat solid colour', light: false
  },
  moonlight: {
    name: 'Moonlight', garment: 'light sand', hex: '#D8CAB0', colors: ['Sand', 'Natural', 'Ash', 'Sport Grey'], titleColour: 'Beige',
    ink: 'deep midnight navy', palette: 'deep midnight navy (#14213D) and cool silver grey (#7D8799), with tiny touches of muted violet (#5B4E8C)',
    finish: 'flat solid colours suitable for screen printing, no gradients that band. Dark ink only: no white, nothing pale that would vanish on a light garment', light: true
  },
  redplanet: {
    name: 'Red Planet', garment: 'deep burgundy', hex: '#5A2330', colors: ['Maroon', 'Burgundy', 'Cardinal Red'], titleColour: 'Burgundy',
    ink: 'warm cream', palette: 'rose gold (#D9A08B), soft peach (#F5C6A5) and warm cream (#FFF1E0)',
    finish: 'flat solid colours suitable for screen printing, no gradients that band', light: false
  }
};
const cw = key => COLOURWAYS[key] || COLOURWAYS.navy;

const BASE = c => `Premium minimalist streetwear graphic for print-on-demand apparel, to be printed on a ${c.garment} garment. Bold, confident line weights: every line and stroke clearly thick enough to print (no hairlines), no tiny specks or dust-like stars, all lettering in one consistent colour. Crisp vector-like edges, ${c.finish}, no photo textures, no mockup, no clothing, no frame, no background scene. Centred, isolated on a fully transparent background with generous empty space. Original artwork: no logos, brands, film or game references, no cartoon aliens, nothing childish.`;

const COLLECTION = {
  name: 'Cosmic Christmas',
  garment: 'dark navy',
  look: 'mysterious, premium, futuristic streetwear; Christmas reimagined as a transmission from another civilisation',
  shirtColors: ['Navy', 'Black', 'Dark Heather'],
  mugBackground: '#0B1530'
};

const DIRECTIONS = {
  signal: {
    name: 'The Signal', hook: 'Alien', theme: 'Space', suffix: ' 2026',
    text: '"MERRY CHRISTMAS" in futuristic alien-inspired lettering, plus "2026" in futuristic numerals',
    textRule: 'The words MERRY CHRISTMAS and the year 2026 must both be present and recognisable, even though they are drawn in stylised futuristic, alien-inspired lettering. No other words.',
    prompt: c => `A bold back-print statement artwork. At the centre, a striking Christmas tree symbol made of exactly three stacked geometric triangles in glowing ${c.ink} line work, each triangle slightly offset like a transmission from deep space, a small four-pointed star at the apex. Fine constellation lines and tiny stars connect the triangles. Arched above the symbol, the words "MERRY CHRISTMAS" in a unique futuristic alien-inspired typeface, angular and geometric, like a language from another civilisation yet still readable. Below, the year "2026" in futuristic glyph-like numerals. Subtle orbit rings and coordinate marks around the composition. Colours: ${c.palette}.`
  },
  starmap: {
    name: 'Star Map 2026', hook: 'Star Map', theme: 'Constellation', suffix: '',
    text: '"25.12.2026" in futuristic numerals',
    textRule: 'The only text is the date 25.12.2026 (or 25 12 2026) in futuristic numerals, recognisable. No other words.',
    prompt: c => `A minimalist celestial chart. A Christmas tree drawn as a constellation: three stacked triangles formed by fine ${c.ink} lines joining bright star points of different sizes, the top star larger and radiant. Around it a thin circular star-chart ring with small tick marks and tiny glyphs. Beneath, the date "25.12.2026" in thin futuristic numerals with wide spacing. Elegant, precise, like an observatory instrument. Colours: ${c.palette}.`
  },
  firstcontact: {
    name: 'First Contact', hook: 'Alien', theme: 'Cosmic', suffix: '',
    text: '"MERRY CHRISTMAS" in an alien-inspired script',
    textRule: 'The words MERRY CHRISTMAS must be present and recognisable, written in a stylised alien-inspired script. No other words.',
    prompt: c => `A mysterious monolith-like emblem: three tall geometric triangles stacked into a Christmas tree silhouette, the lowest triangle casting a beam of fine parallel light lines downward, as if the tree were a portal or beacon arriving from space. A thin ring orbits the middle triangle. Small scattered stars and two or three tiny unknown symbols nearby. Underneath, "MERRY CHRISTMAS" in an angular alien-inspired script, characters built from triangles and dots, still readable. Colours: ${c.palette}.`
  },
  transmission: {
    name: 'Transmission', hook: 'Space', theme: 'Cosmic Sci Fi', suffix: '',
    text: '"MERRY CHRISTMAS" and "MMXXVI"',
    textRule: 'The words MERRY CHRISTMAS and MMXXVI must be present and recognisable, in futuristic lettering. No other words.',
    prompt: c => `A bold minimalist streetwear graphic. Three solid ${c.ink} geometric triangles stacked into a Christmas tree, with clean negative-space gaps, centred inside a thin circle like a mission patch from an unknown space programme. Around the circle edge, small futuristic glyph marks. Below the patch, "MERRY CHRISTMAS" in wide, heavy futuristic sans-serif capitals, and under it "MMXXVI" in small spaced letters. Confident, graphic, premium. Colours: ${c.palette}.`
  }
};

// The small chest emblem used on the front of every hoodie (the big artwork goes on the back).
const EMBLEM_PROMPT = (key = 'navy') => { const c = cw(key); return `A small minimalist chest emblem: three stacked geometric triangles forming a Christmas tree in ${c.ink} line work, a tiny four-pointed star on top, two tiny orbiting dots. Colours: ${c.palette}. No text at all. Bold enough to read when printed 8cm wide. ${BASE(c)}`; };

function designPrompt(key, product, feedback, colourway) {
  const d = DIRECTIONS[key];
  const c = cw(colourway);
  let p = `${d.prompt(c)} ${BASE(c)}`;
  if (feedback) p += ` Important fix from review: ${feedback}`;
  return p;
}

// Short, plain Etsy titles (agreed 3 Nov): what it is + colour + one hook, about 50-60 characters.
// e.g. "Alien Christmas Jumper, Navy Space Sweatshirt 2026"
function shortTitle(key, kind, colourwayKey) {
  const d = DIRECTIONS[key] || {};
  const c = cw(colourwayKey);
  const noun = kind === 'hoodie' ? ['Hoodie', 'Hoodie'] : kind === 'mug' ? ['Mug', 'Mug'] : ['Jumper', 'Sweatshirt'];
  return `${d.hook || 'Cosmic'} Christmas ${noun[0]}, ${c.titleColour} ${d.theme || 'Space'} ${noun[1]}${d.suffix || ''}`;
}

// Merge the collection defaults into each direction for the rest of the office.
for (const d of Object.values(DIRECTIONS)) Object.assign(d, { look: COLLECTION.look, shirtColors: COLLECTION.shirtColors, mugBackground: COLLECTION.mugBackground }, d);

module.exports = { shortTitle, BRAND, DIRECTIONS, COLLECTION, COLOURWAYS, colourway: cw, EMBLEM_PROMPT, designPrompt };
