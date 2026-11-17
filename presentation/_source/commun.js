// Briques communes aux deux présentations : thème calqué sur le Hub, mises en page, icônes, cadres d'écran.
const path = require('path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const sharp = require('sharp');
const Fi = require('react-icons/fi');
const pptxgen = require('pptxgenjs');

const IMG = path.join(__dirname, '..', '_images');
const img = n => path.join(IMG, n);

// Les couleurs du Hub (Tailwind : indigo-600, violet-600, emerald-600, gray-500, indigo-100, indigo-300).
const THEME = {
  name: 'TheSocle Hub',
  headFontFace: 'Arial',
  bodyFontFace: 'Arial',
  colors: {
    dk1: '111827', lt1: 'FFFFFF', dk2: '1E1B4B', lt2: 'F9FAFB',
    accent1: '4F46E5', accent2: '7C3AED', accent3: '059669', accent4: '6B7280',
    accent5: 'E0E7FF', accent6: 'A5B4FC', hlink: 'C7D2FE', folHlink: 'DDD6FE',
  },
};
const HEX = { bord: 'E5E7EB', ombre: '1E1B4B' };

function nouvellePresentation(titre) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE'; // 13,333 × 7,5 po
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.title = titre;
  pres.author = 'TheSocle';
  pres.company = 'LMVI Conseil';
  const C = pres.SchemeColor;
  const K = {
    encre: C.text1, nuit: C.text2, blanc: C.background1, fond: C.background2,
    indigo: C.accent1, violet: C.accent2, vert: C.accent3, gris: C.accent4, pale: C.accent5, lavande: C.accent6,
  };

  // Contenu : fond gris très clair du Hub, titre en haut, pied discret.
  pres.defineSlideMaster({
    title: 'CONTENU',
    background: { color: K.fond },
    margin: [0.4, 0.6, 0.6, 0.6],
    objects: [
      { image: { x: 0.6, y: 7.0, w: 0.22, h: 0.22, path: img('logo-indigo.png') } },
      { text: { text: "TheSocle · la méthode Besoin→Plan", options: { x: 0.88, y: 6.98, w: 5, h: 0.26, fontSize: 10, color: K.gris, margin: 0, isTextBox: true } } },
      { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.35, w: 12.1, h: 0.8, fontSize: 30, bold: true, color: K.encre, valign: 'top', align: 'left', margin: 0 }, text: '' } },
      { placeholder: { options: { name: 'chapo', type: 'body', x: 0.6, y: 1.08, w: 12.1, h: 0.5, fontSize: 16, color: K.gris, valign: 'top', align: 'left', margin: 0 }, text: '' } },
    ],
    slideNumber: { x: 12.2, y: 6.98, w: 0.5, h: 0.26, fontSize: 10, color: K.gris, align: 'right' },
  });
  // Ouverture et clôture : la nuit indigo du bandeau du Hub.
  pres.defineSlideMaster({
    title: 'SOMBRE',
    background: { color: K.nuit },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.8, y: 2.3, w: 7.2, h: 1.9, fontSize: 44, bold: true, color: K.blanc, valign: 'top', align: 'left', margin: 0 }, text: '' } },
      { placeholder: { options: { name: 'chapo', type: 'body', x: 0.8, y: 4.35, w: 7.0, h: 1.4, fontSize: 18, color: K.lavande, valign: 'top', align: 'left', margin: 0 }, text: '' } },
    ],
  });
  // Intercalaire : l'indigo du bouton principal du Hub.
  pres.defineSlideMaster({
    title: 'SECTION',
    background: { color: K.indigo },
    objects: [
      { placeholder: { options: { name: 'numero', type: 'body', x: 0.8, y: 2.2, w: 3, h: 1.0, fontSize: 54, bold: true, color: K.lavande, margin: 0 }, text: '' } },
      { placeholder: { options: { name: 'title', type: 'title', x: 0.8, y: 3.25, w: 11.5, h: 1.1, fontSize: 40, bold: true, color: K.blanc, valign: 'top', align: 'left', margin: 0 }, text: '' } },
      { placeholder: { options: { name: 'chapo', type: 'body', x: 0.8, y: 4.4, w: 10, h: 1.0, fontSize: 18, color: K.pale, valign: 'top', align: 'left', margin: 0 }, text: '' } },
    ],
  });
  return { pres, K };
}

// Icône Feather (le trait fin des écrans du Hub) → PNG base64.
const cache = {};
async function icone(nom, couleur = '#FFFFFF') {
  const cle = nom + couleur;
  if (!cache[cle]) {
    const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Fi[nom], { color: couleur, size: 256, strokeWidth: 1.8 }));
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    cache[cle] = 'image/png;base64,' + png.toString('base64');
  }
  return cache[cle];
}

// Le motif : la tuile arrondie des applications du portail, icône blanche dedans.
async function tuile(slide, K, nom, x, y, t = 0.6, fond) {
  slide.addShape('roundRect', { x, y, w: t, h: t, rectRadius: t * 0.22, fill: { color: fond || K.violet }, line: { type: 'none' }, objectName: 'tuile ' + nom });
  const m = t * 0.24;
  slide.addImage({ data: await icone(nom), x: x + m, y: y + m, w: t - 2 * m, h: t - 2 * m, altText: '' });
}

// Une carte blanche du Hub : coins arrondis, bord gris, ombre douce.
function carte(slide, K, x, y, w, h, nom = 'carte') {
  slide.addShape('roundRect', {
    x, y, w, h, rectRadius: 0.12, fill: { color: K.blanc }, line: { color: HEX.bord, width: 0.75 },
    shadow: { type: 'outer', color: HEX.ombre, opacity: 0.08, blur: 8, offset: 2, angle: 90 }, objectName: nom,
  });
}

// Un écran du Hub dans son cadre ; les captures sont au rapport 1440 × 864.
function ecran(slide, K, fichier, x, y, w, legende, alt) {
  const h = w * 0.6;
  slide.addShape('roundRect', {
    x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12, rectRadius: 0.1, fill: { color: K.blanc }, line: { color: HEX.bord, width: 0.75 },
    shadow: { type: 'outer', color: HEX.ombre, opacity: 0.16, blur: 14, offset: 4, angle: 90 }, objectName: 'cadre ' + fichier,
  });
  slide.addImage({ path: img(fichier), x, y, w, h, altText: alt || legende || fichier });
  if (legende) slide.addText(legende, { x, y: y + h + 0.12, w, h: 0.3, fontSize: 11, color: K.gris, italic: true, margin: 0, isTextBox: true });
  return h;
}

// Pastille d'état, comme les badges « active » du Hub.
function pastille(slide, K, texte, x, y, w, fond, couleur) {
  slide.addShape('roundRect', { x, y, w, h: 0.32, rectRadius: 0.16, fill: { color: fond || K.pale }, line: { type: 'none' } });
  slide.addText(texte, { x, y, w, h: 0.32, fontSize: 12, bold: true, color: couleur || K.indigo, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
}

module.exports = { THEME, HEX, nouvellePresentation, icone, tuile, carte, ecran, pastille, img };
