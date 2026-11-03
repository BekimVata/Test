// Banians creative direction (from Bekim, 3 Nov 2026):
// cosmic aesthetics + futuristic design + mysterious symbolism + bold minimalist streetwear.
// Christmas reimagined through a futuristic lens. Central motif: three geometric triangles forming a tree.
// Palette: deep midnight blue, rich navy, cosmic black, brilliant white, subtle celestial highlights.

// The Banians brand, year-round. Collections change with the seasons; the identity doesn't.
const BRAND = 'Banians is a year-round UK clothing brand whose designs blend cosmic wonder (stars, constellations, galaxies, the unknown) with the beauty of nature, in bold, minimal, premium artwork people are proud to wear. It is for everyone: never describe it as for men, women or any one group. New collections arrive through the year (Christmas now, then Halloween, Valentine\'s Day and everyday pieces), so never describe Banians as a Christmas shop.';

const BASE = 'Premium minimalist streetwear graphic for print-on-demand apparel, to be printed on a dark navy garment. Bold, confident line weights: every line and stroke clearly thick enough to print (no hairlines), no tiny specks or dust-like stars, all lettering in one consistent colour. Crisp vector-like edges, flat solid colours suitable for screen printing, no gradients that band, no photo textures, no mockup, no clothing, no frame, no background scene. Centred, isolated on a fully transparent background with generous empty space. Original artwork: no logos, brands, film or game references, no cartoon aliens, nothing childish.';
const PALETTE = 'brilliant white, ice blue (#A9C6D9) and pale silver, with tiny touches of soft violet starlight (#B8A9E8)';

const COLLECTION = {
  name: 'Cosmic Christmas',
  garment: 'dark navy',
  look: 'mysterious, premium, futuristic streetwear; Christmas reimagined as a transmission from another civilisation',
  shirtColors: ['Navy', 'Black', 'Dark Heather'],
  mugBackground: '#0B1530'
};

const DIRECTIONS = {
  signal: {
    name: 'The Signal',
    text: '"MERRY CHRISTMAS" in futuristic alien-inspired lettering, plus "2026" in futuristic numerals',
    textRule: 'The words MERRY CHRISTMAS and the year 2026 must both be present and recognisable, even though they are drawn in stylised futuristic, alien-inspired lettering. No other words.',
    palette: PALETTE,
    prompt: `A bold back-print statement artwork. At the centre, a striking Christmas tree symbol made of exactly three stacked geometric triangles in glowing white line work, each triangle slightly offset like a transmission from deep space, a small four-pointed star at the apex. Fine constellation lines and tiny stars connect the triangles. Arched above the symbol, the words "MERRY CHRISTMAS" in a unique futuristic alien-inspired typeface, angular and geometric, like a language from another civilisation yet still readable. Below, the year "2026" in futuristic glyph-like numerals. Subtle orbit rings and coordinate marks around the composition. Colours: ${PALETTE}.`
  },
  starmap: {
    name: 'Star Map 2026',
    text: '"25.12.2026" in futuristic numerals',
    textRule: 'The only text is the date 25.12.2026 (or 25 12 2026) in futuristic numerals, recognisable. No other words.',
    palette: PALETTE,
    prompt: `A minimalist celestial chart. A Christmas tree drawn as a constellation: three stacked triangles formed by fine white lines joining bright star points of different sizes, the top star larger and radiant. Around it a thin circular star-chart ring with small tick marks and tiny glyphs. Beneath, the date "25.12.2026" in thin futuristic numerals with wide spacing. Elegant, precise, like an observatory instrument. Colours: ${PALETTE}.`
  },
  firstcontact: {
    name: 'First Contact',
    text: '"MERRY CHRISTMAS" in an alien-inspired script',
    textRule: 'The words MERRY CHRISTMAS must be present and recognisable, written in a stylised alien-inspired script. No other words.',
    palette: PALETTE,
    prompt: `A mysterious monolith-like emblem: three tall geometric triangles stacked into a Christmas tree silhouette, the lowest triangle casting a beam of fine parallel light lines downward, as if the tree were a portal or beacon arriving from space. A thin ring orbits the middle triangle. Small scattered stars and two or three tiny unknown symbols nearby. Underneath, "MERRY CHRISTMAS" in an angular alien-inspired script, characters built from triangles and dots, still readable. Colours: ${PALETTE}.`
  },
  transmission: {
    name: 'Transmission',
    text: '"MERRY CHRISTMAS" and "MMXXVI"',
    textRule: 'The words MERRY CHRISTMAS and MMXXVI must be present and recognisable, in futuristic lettering. No other words.',
    palette: PALETTE,
    prompt: `A bold minimalist streetwear graphic. Three solid white geometric triangles stacked into a Christmas tree, with clean negative-space gaps, centred inside a thin circle like a mission patch from an unknown space programme. Around the circle edge, small futuristic glyph marks. Below the patch, "MERRY CHRISTMAS" in wide, heavy futuristic sans-serif capitals, and under it "MMXXVI" in small spaced letters. Confident, graphic, premium. Colours: ${PALETTE}.`
  }
};

// The small chest emblem used on the front of every hoodie (the big artwork goes on the back).
const EMBLEM_PROMPT = `A small minimalist chest emblem: three stacked geometric triangles forming a Christmas tree in brilliant white line work, a tiny four-pointed star on top, two tiny orbiting dots. No text at all. Bold enough to read when printed 8cm wide. ${BASE}`;

function designPrompt(key, product, feedback) {
  const d = DIRECTIONS[key];
  let p = `${d.prompt} ${BASE}`;
  if (feedback) p += ` Important fix from review: ${feedback}`;
  return p;
}

// Merge the collection defaults into each direction for the rest of the office.
for (const d of Object.values(DIRECTIONS)) Object.assign(d, { look: COLLECTION.look, shirtColors: COLLECTION.shirtColors, mugBackground: COLLECTION.mugBackground }, d);

module.exports = { BRAND, DIRECTIONS, COLLECTION, EMBLEM_PROMPT, designPrompt };
