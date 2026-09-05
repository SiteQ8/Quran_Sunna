/* Sadu drawn, not photographed: three bands in the vocabulary of the weave,
   each a tile that repeats, in the colours of the pieces themselves. */
const CREAM = '#f3e9d2', BLACK = '#1a1412', RED = '#9c2b2b', DARK = '#5a1414', GOLD = '#d9a441', ORANGE = '#d8552a', TEAL = '#1f6f78';
const uri = (svg) => `url('data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}')`;

/* the runner: a column of eyes between dotted stripes and thin threads, 168 wide, repeats down */
export const runner = () => uri(`<svg xmlns='http://www.w3.org/2000/svg' width='168' height='120' viewBox='0 0 168 120'>
<rect width='168' height='120' fill='${CREAM}'/>
<rect x='0' width='10' height='120' fill='${BLACK}'/><rect x='158' width='10' height='120' fill='${BLACK}'/>
<rect x='14' width='6' height='120' fill='${ORANGE}'/><rect x='148' width='6' height='120' fill='${ORANGE}'/>
<rect x='24' width='4' height='120' fill='${TEAL}'/><rect x='140' width='4' height='120' fill='${TEAL}'/>
<g fill='${BLACK}'>${[0,1,2,3,4,5].map(i=>`<rect x='32' y='${i*20+4}' width='8' height='8'/><rect x='128' y='${i*20+14}' width='8' height='8'/>`).join('')}</g>
<rect x='44' width='80' height='120' fill='${RED}'/>
<path d='M84 6 L118 60 L84 114 L50 60z' fill='${CREAM}'/><path d='M84 22 L106 60 L84 98 L62 60z' fill='${BLACK}'/><path d='M84 38 L94 60 L84 82 L74 60z' fill='${CREAM}'/><path d='M84 50 L90 60 L84 70 L78 60z' fill='${RED}'/>
</svg>`);

/* the cushion band: rows of triangles and a zigzag stitched between, 120 tall, repeats across */
export const cushion = () => uri(`<svg xmlns='http://www.w3.org/2000/svg' width='96' height='120' viewBox='0 0 96 120'>
<rect width='96' height='120' fill='${BLACK}'/>
<rect y='0' width='96' height='4' fill='${GOLD}'/><rect y='116' width='96' height='4' fill='${GOLD}'/>
<g fill='${RED}'>${[0,1,2,3].map(i=>`<path d='M${i*24} 8 l12 20 l12 -20z'/><path d='M${i*24} 112 l12 -20 l12 20z'/>`).join('')}</g>
<g fill='${CREAM}'>${[0,1,2,3].map(i=>`<path d='M${i*24+12} 8 l12 20 l-12 0z' opacity='.9'/><path d='M${i*24+12} 112 l12 -20 l-12 0z' opacity='.9'/>`).join('')}</g>
<rect y='34' width='96' height='2' fill='${CREAM}'/><rect y='84' width='96' height='2' fill='${CREAM}'/>
<path d='M0 68 L12 44 L24 68 L36 44 L48 68 L60 44 L72 68 L84 44 L96 68' fill='none' stroke='${CREAM}' stroke-width='5'/>
<path d='M0 76 L12 52 L24 76 L36 52 L48 76 L60 52 L72 76 L84 52 L96 76' fill='none' stroke='${RED}' stroke-width='3'/>
</svg>`);

/* the cloth's motif: the stacked tree and the hourglass, in black on cream, 120 wide, repeats down */
export const tree = () => uri(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='200' viewBox='0 0 120 200'>
<rect width='120' height='200' fill='${CREAM}'/>
<rect x='0' width='8' height='200' fill='${RED}'/><rect x='112' width='8' height='200' fill='${RED}'/>
<g fill='${BLACK}'>
${[0,1,2,3,4].map(i=>`<rect x='12' y='${i*40+6}' width='6' height='6'/><rect x='102' y='${i*40+26}' width='6' height='6'/>`).join('')}
<path d='M60 10 L96 60 L24 60z'/><path d='M60 30 L84 60 L36 60z' fill='${CREAM}'/><path d='M60 44 L72 60 L48 60z'/>
<path d='M24 76 L96 76 L60 120z'/><path d='M24 164 L96 164 L60 120z'/><path d='M40 84 L80 84 L60 110z' fill='${CREAM}'/><path d='M40 156 L80 156 L60 130z' fill='${CREAM}'/>
<path d='M24 172 L36 190 L48 172 L60 190 L72 172 L84 190 L96 172 L96 196 L24 196z'/>
</g></svg>`);

export const colours = { CREAM, BLACK, RED, DARK, GOLD, ORANGE, TEAL };
