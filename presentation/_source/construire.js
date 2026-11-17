// Construit Besoin2Plan-la-methode.pptx : la méthode Besoin→Plan expliquée et justifiée.
// Même graphisme que 09-CONTENUS-THESOCLE/PowerPoint (commun.js et couches.js en sont des copies).
// Usage : NODE_PATH=<node_modules avec pptxgenjs, react-icons, react, react-dom, sharp>
//         APPLY_THEME=<skill pptx>/scripts/apply_theme.js node construire.js
// Chaque chiffre a sa source dans les notes de l'orateur.
const path = require('path');
const { THEME, nouvellePresentation, icone, tuile, carte, pastille } = require('./commun');
const { applyTheme } = require(process.env.APPLY_THEME);
const B = require('./couches');

const SORTIE = path.join(__dirname, '..', 'Besoin2Plan-la-methode.pptx');
const BORD = 'E5E7EB';

// ---------------------------------------------------------------- briques
function contenu(pres, section, titre, chapo) {
  const s = pres.addSlide({ masterName: 'CONTENU', sectionTitle: section });
  s.addText(titre, { placeholder: 'title' });
  if (chapo) s.addText(chapo, { placeholder: 'chapo' });
  return s;
}
function intercalaire(pres, section, numero, titre, chapo, notes) {
  pres.addSection({ title: section });
  const s = pres.addSlide({ masterName: 'SECTION', sectionTitle: section });
  s.addText(numero, { placeholder: 'numero' });
  s.addText(titre, { placeholder: 'title' });
  s.addText(chapo, { placeholder: 'chapo' });
  if (notes) s.addNotes(notes);
  return s;
}
function txt(s, t, o) { s.addText(t, Object.assign({ margin: 0, isTextBox: true }, o)); }
function bande(s, x, y, w, h, fond, nom) {
  s.addShape('roundRect', { x, y, w, h, rectRadius: 0.12, fill: { color: fond }, line: { type: 'none' }, objectName: nom });
}
function fleche(s, K, x, y, w, h, couleur) {
  s.addShape('line', { x, y, w, h, line: { color: couleur || K.indigo, width: 2, endArrowType: 'triangle' } });
}
function rond(s, K, texte, x, y, d, fond, taille) {
  s.addShape('ellipse', { x, y, w: d, h: d, fill: { color: fond || K.indigo }, line: { color: 'FFFFFF', width: 2 } });
  txt(s, texte, { x, y, w: d, h: d, fontSize: taille || 14, bold: true, color: K.blanc, align: 'center', valign: 'middle' });
}
function regle(s, K, etiquette, texte, y = 5.75, h = 0.95) {
  bande(s, 0.6, y, 12.1, h, K.nuit, 'règle');
  txt(s, [{ text: etiquette + '  ', options: { bold: true, color: K.lavande } }, { text: texte, options: { color: K.blanc } }],
    { x: 0.9, y, w: 11.5, h, fontSize: 15, valign: 'middle' });
}
// Une carte : tuile, titre, texte.
async function carteTexte(s, K, x, y, w, h, ic, titre, texte, fond, tailleTexte = 13, dy = 1.5) {
  carte(s, K, x, y, w, h, 'carte ' + titre);
  await tuile(s, K, ic, x + 0.22, y + 0.22, 0.48, fond);
  txt(s, titre, { x: x + 0.22, y: y + 0.82, w: w - 0.44, h: dy - 0.86, fontSize: 15, bold: true, color: K.encre, valign: 'top' });
  txt(s, texte, { x: x + 0.22, y: y + dy, w: w - 0.44, h: h - dy - 0.1, fontSize: tailleTexte, color: K.gris, valign: 'top' });
}
// Une ligne « tuile + titre + texte ».
async function point(s, K, ic, x, y, w, titre, texte, fond, h = 0.95) {
  await tuile(s, K, ic, x, y, 0.46, fond || K.indigo);
  txt(s, [{ text: titre, options: { bold: true, fontSize: 15, color: K.encre, breakLine: true } }, { text: texte, options: { fontSize: 13, color: K.gris } }],
    { x: x + 0.64, y: y - 0.04, w: w - 0.64, h, valign: 'top', paraSpaceAfter: 2 });
}
// Un tableau au style du Hub : en-tête indigo, lignes blanches.
function tableau(s, K, x, y, largeurs, lignes, o = {}) {
  const rows = lignes.map((r, j) => r.map((c, k) => ({
    text: c,
    options: {
      bold: j === 0 || (o.premiereGras && k === 0), fontSize: j === 0 ? 13 : (o.taille || 13),
      color: j === 0 ? 'FFFFFF' : (k === 0 && o.premiereCouleur ? o.premiereCouleur : '111827'),
      fill: { color: j === 0 ? '4F46E5' : (j % 2 ? 'FFFFFF' : 'F9FAFB') }, valign: 'middle', margin: [0.05, 0.1, 0.05, 0.1],
    },
  })));
  s.addTable(rows, { x, y, w: largeurs.reduce((a, b) => a + b, 0), colW: largeurs, rowH: o.rowH || 0.5, border: { type: 'solid', color: BORD, pt: 0.75 } });
}

// ---------------------------------------------------------------- la présentation
async function construire() {
  const { pres, K } = nouvellePresentation('Besoin→Plan — la méthode');
  pres.subject = 'La méthode LMVI Besoin→Plan, ses contrôles adversariaux et ses tests';

  // ================================================================ Ouverture
  pres.addSection({ title: 'Ouverture' });
  let s = pres.addSlide({ masterName: 'SOMBRE', sectionTitle: 'Ouverture' });
  s.addImage({ path: path.join(__dirname, '..', '_images', 'logo-blanc.png'), x: 0.8, y: 0.8, w: 0.55, h: 0.55, altText: 'Logo TheSocle' });
  txt(s, 'TheSocle', { x: 1.5, y: 0.8, w: 4, h: 0.55, fontSize: 24, bold: true, color: K.blanc, valign: 'middle' });
  s.addText('La méthode Besoin→Plan', { placeholder: 'title' });
  s.addText('Du besoin au plan prouvé : les contrepoids qui encadrent chaque décision, les tests qui prouvent chaque promesse, et la raison de chaque règle.', { placeholder: 'chapo' });
  txt(s, 'Novembre 2026 · kit 1.16.0', { x: 0.8, y: 6.5, w: 6, h: 0.35, fontSize: 12, color: K.lavande });
  const trio = [['FiCheckSquare', 'Décider', 'avant de construire'], ['FiUsers', 'Contrebalancer', 'chaque décision par un tiers'], ['FiShield', 'Prouver', 'tout ce qu\'on affirme']];
  for (const [i, [ic, t, d]] of trio.entries()) {
    const y = 1.7 + i * 1.5;
    s.addShape('roundRect', { x: 8.7, y, w: 3.9, h: 1.2, rectRadius: 0.14, fill: { color: '312E81' }, line: { type: 'none' }, objectName: 'pilier ' + t });
    await tuile(s, K, ic, 8.95, y + 0.3, 0.6, i === 1 ? K.violet : K.indigo);
    txt(s, [{ text: t, options: { bold: true, fontSize: 20, color: K.blanc, breakLine: true } }, { text: d, options: { fontSize: 14, color: K.lavande } }],
      { x: 9.8, y, w: 2.7, h: 1.2, valign: 'middle' });
  }
  s.addNotes("Cette présentation explique la méthode LMVI Besoin→Plan telle qu'elle est aujourd'hui (kit 1.16.0, 2026-10-28) et justifie chacune de ses règles. "
    + "Quatre parties : la chaîne M0→M7 ; les contrepoids, c'est-à-dire les contrôles qui empêchent une décision de se valider toute seule ; "
    + "les tests ; et l'historique, version par version, de ce qui a été ajouté et pourquoi. Source : docs/methode-lmvi (dépôt github.com/jmlmvi/methode-lmvi).");

  s = contenu(pres, 'Ouverture', 'La méthode en une page : cinq principes',
    'Tout le reste (maillons, gabarits, scripts) découle de ces cinq règles.');
  const principes = [
    ['FiShield', 'La preuve externe', 'Tout artefact est prouvé par quelque chose qui lui est extérieur : un test, un contre-exemple, une démo, un relecteur.'],
    ['FiGrid', 'Trois axes séparés', 'Métier, technique et livraison ne se croisent que dans la matrice de couverture.'],
    ['FiCheckSquare', 'Décider avant de construire', 'Le doute est marqué [À ARBITRER] puis tranché, jamais enfoui dans le code.'],
    ['FiRepeat', 'Livrer en mini-cycles', 'Chaque phase finit par une démo réelle, et revérifie les phases précédentes.'],
    ['FiSlash', 'L\'honnêteté technique', 'Zéro simulation, zéro faux vert ; on ne recode pas ce que la plateforme fournit.'],
  ];
  for (const [i, [ic, t, d]] of principes.entries()) {
    const x = 0.6 + i * 2.455;
    await carteTexte(s, K, x, 1.85, 2.3, 3.6, ic, t, d, i % 2 ? K.indigo : K.violet);
  }
  regle(s, K, 'La question', 'qu\'est-ce qui, hors de cet artefact, prouve qu\'il est juste ? Sans réponse, c\'est une opinion bien présentée.');
  s.addNotes("Source : ESSENTIEL.md, la philosophie de la méthode en une page. Le premier principe (la preuve externe) est le principe unificateur ajouté en 1.7.0 : "
    + "il explique tous les autres. Les contrepoids de la partie 2 et les tests de la partie 3 en sont des déclinaisons.");

  // ================================================================ 01 La chaîne
  intercalaire(pres, 'La chaîne', '01', 'La chaîne M0 → M7', 'Huit maillons, chacun avec son entrée, son livrable et sa définition de fini.',
    "Source : conception/METHODE-Besoin2Plan.md §1. Chaque maillon a une entrée, un livrable, des règles et une définition de fini (DoD).");
  await B.diapoArrets(pres, K, 'La chaîne');

  const maillons = (liste) => liste.map(([m, nom, livrable, regleTxt, dod]) => ({ m, nom, livrable, regleTxt, dod }));
  async function diapoMaillons(titre, chapo, liste, notes) {
    const s = contenu(pres, 'La chaîne', titre, chapo);
    for (const [i, c] of maillons(liste).entries()) {
      const x = 0.6 + i * 3.07, w = 2.9;
      carte(s, K, x, 1.85, w, 4.85, c.nom);
      rond(s, K, c.m, x + 0.22, 2.05, 0.6, c.m === 'M7' ? K.vert : K.indigo, 14);
      txt(s, c.nom, { x: x + 0.95, y: 2.05, w: w - 1.1, h: 0.6, fontSize: 16, bold: true, color: K.encre, valign: 'middle' });
      txt(s, [
        { text: 'Livrable', options: { bold: true, color: K.indigo, breakLine: true } }, { text: c.livrable, options: { color: K.encre, breakLine: true } },
        { text: ' ', options: { fontSize: 6, breakLine: true } },
        { text: 'Règle', options: { bold: true, color: K.violet, breakLine: true } }, { text: c.regleTxt, options: { color: K.encre, breakLine: true } },
        { text: ' ', options: { fontSize: 6, breakLine: true } },
        { text: 'Fini quand', options: { bold: true, color: K.vert, breakLine: true } }, { text: c.dod, options: { color: K.encre } },
      ], { x: x + 0.22, y: 2.85, w: w - 0.4, h: 3.7, fontSize: 12.5, valign: 'top' });
    }
    s.addNotes(notes);
    return s;
  }
  await diapoMaillons('M0 → M3 : du besoin aux user stories', 'Le QUOI, jamais le COMMENT : aucune solution technique avant M6.', [
    ['M0', 'Vision', 'la vision en 3 à 5 lignes, les acteurs, le casting (dont le relecteur), le profil.', 'reformuler et faire confirmer avant d\'écrire quoi que ce soit.', 'le commanditaire dit « oui, c\'est ça ».'],
    ['M1', 'Besoins et règles', 'la spec : vocabulaire, entités, une fiche par règle de gestion, matrice des droits, exigences non fonctionnelles.', 'tout terme défini une fois ; chaque doute marqué [À ARBITRER].', 'un relecteur qui ne l\'a pas écrite comprend le domaine sans le code.'],
    ['M2', 'User stories', '« En tant que…, je veux…, afin de… » et leurs critères d\'acceptation.', 'une US = une intention testable ; ni phase ni brique dans la fiche.', 'chaque US est démontrable par un test.'],
    ['M3', 'Features et épics', 'les US rangées en features (capacités démontrables), elles-mêmes rangées en épics.', 'une seule feature propriétaire par US ; aucune feature vide.', 'la hiérarchie Épic → Feature → US est complète.'],
  ], "Source : METHODE §1, maillons M0 à M3. M1 est relu obligatoirement par un relecteur différent en nature. En mode « CdC fourni », M0 et M1 s'extraient du cahier "
    + "des charges avec traçabilité (chaque US et chaque règle cite son paragraphe), et les trous du CdC deviennent les [À ARBITRER].");
  await diapoMaillons('M4 → M7 : des décisions au code', 'Le plan n\'existe qu\'une fois les décisions tranchées.', [
    ['M4', 'Arbitrages', 'le journal des décisions : option retenue, pourquoi, impact ; rapatrié dans la spec.', 'on ne passe pas au plan tant qu\'une décision structurante est ouverte.', 'plus aucune décision bloquante, toutes écrites. Relu.'],
    ['M5', 'Phasage', 'des phases P-0…P-n, chacune avec une gate formulée comme une démo.', 'chaque phase a une valeur démontrable seule ; estimation ré-estimée ×2.', 'chaque gate est une démo vue par le rôle, pas une tâche.'],
    ['M6', 'Plan technique', 'briques, données, matrice de couverture, plan de test, droits → IAM.', 'chaque brique cite son service, son pack ou sa fiche, sinon NON COUVERT.', 'aucune US oubliée, aucune brique orpheline. Relu.'],
    ['M7', 'Exécution', 'le câblage (où, avec quoi, sur quoi) et un dossier de suivi par phase.', 'preuve réelle à chaque gate, gates précédentes revérifiées, zéro simulation.', 'la première phase est suivie, la cible d\'exécution connue.'],
  ], "Source : METHODE §1, maillons M4 à M7. M4 est « le maillon souvent oublié » : sans lui, les décisions se prennent en silence dans le code. "
    + "La règle ×2 (M5) et « P-0 = socle » sont marquées ⚗️ règles candidates : issues d'un seul chantier, à confirmer.");

  s = contenu(pres, 'La chaîne', 'Le bon niveau d\'outillage, ni plus ni moins',
    'Deux réglages déclarés en M0 : comment le besoin arrive, et quel profil de chantier.');
  const profils = [
    ['express', '3 arrêts', 'M0, M1 proportionné, M4, matrice M6, 1 à 2 phases', 'feature courte, domaine connu'],
    ['solo', '6 arrêts', 'toute la conception : chaîne, règles, droits, plan de test', 'application interne'],
    ['client', '6 arrêts + PV', 'conception, conformité (RGPD, risques, recette) et run', 'chantier contractuel'],
  ];
  txt(s, 'Le profil', { x: 0.6, y: 1.8, w: 7.4, h: 0.35, fontSize: 15, bold: true, color: K.encre });
  for (const [i, [p, arr, art, pour]] of profils.entries()) {
    const y = 2.25 + i * 1.18;
    carte(s, K, 0.6, y, 7.4, 1.02, 'profil ' + p);
    pastille(s, K, p, 0.8, y + 0.35, 1.2, i === 2 ? 'EDE9FE' : 'E0E7FF', i === 2 ? K.violet : K.indigo);
    txt(s, [{ text: arr + ' · ', options: { bold: true, color: K.encre } }, { text: pour, options: { color: K.gris, breakLine: true } }, { text: art, options: { color: K.gris, fontSize: 12 } }],
      { x: 2.2, y, w: 5.65, h: 1.02, fontSize: 14, valign: 'middle' });
  }
  txt(s, 'Le mode d\'entrée', { x: 8.3, y: 1.8, w: 4.4, h: 0.35, fontSize: 15, bold: true, color: K.encre });
  await carteTexte(s, K, 8.3, 2.25, 4.4, 1.68, 'FiMessageSquare', 'Besoin exprimé', 'oral, en vrac : M0 et M1 s\'écrivent en reformulant.', K.indigo, 13, 1.2);
  await carteTexte(s, K, 8.3, 4.05, 4.4, 1.68, 'FiFileText', 'Cahier des charges fourni', 'M1 s\'en extrait ; ses trous deviennent [À ARBITRER].', K.violet, 13, 1.2);
  regle(s, K, 'Le seuil', 'si l\'intention tient dans un message et se prouve par un test, on ne déroule aucune méthode : on fait, on prouve, on journalise.', 5.85, 0.85);
  s.addNotes("Source : conception/PROFILS.md (1.7.0). Règle d'or : un profil ne contraint jamais la taille des documents, seulement les artefacts requis et les arrêts. "
    + "On peut monter de profil ; on ne descend jamais en silence (c'est une décision M4). Pourquoi un seuil : une méthode déroulée sur un correctif de deux heures "
    + "est le meilleur moyen de la faire contourner ensuite.");

  await B.diapoMatrice(pres, K, 'La chaîne');
  await B.diapoRoutage(pres, K, 'La chaîne');

  // ================================================================ 02 Les contrepoids
  intercalaire(pres, 'Les contrepoids', '02', 'Les contrepoids', 'Aucune décision ne se valide toute seule : chacune passe devant quelqu\'un ou quelque chose qui ne l\'a pas prise.',
    "Partie 2 : les contrôles adversariaux. Le principe est celui de la preuve externe appliqué aux décisions : l'auteur d'un livrable n'est jamais celui qui le valide.");

  s = contenu(pres, 'Les contrepoids', 'Sept contrepoids, du premier maillon au dernier',
    'Chacun a un moment, un contrôleur différent de l\'auteur, et un défaut précis qu\'il empêche.');
  tableau(s, K, 0.6, 1.8, [3.1, 2.0, 3.3, 3.7], [
    ['Contrepoids', 'Quand', 'Qui contrôle', 'Ce qu\'il empêche'],
    ['Confirmation de la vision', 'M0 · arrêt ①', 'le commanditaire', 'partir sur un besoin mal compris'],
    ['Relecture adversariale', 'M1, M4, M6', 'un autre modèle ou un humain métier', 'la complaisance de l\'auteur qui se relit'],
    ['[À ARBITRER] tranché en M4', 'M1 → arrêt ③', 'le commanditaire, une question à la fois', 'une décision prise en douce dans la spec ou le code'],
    ['Assertions du générateur', 'M2, M3, M6', 'un script', 'une US orpheline, une feature vide'],
    ['Contrôle avant go', 'arrêt ⑥', 'une grille + un script', 'un plan qui enfreint la plateforme'],
    ['Gate = démo', 'chaque phase', 'le recetteur, dans le rôle', 'une phase « finie » qui ne marche pas'],
    ['Proposition d\'arrêt', 'à tout moment', 'le commanditaire décide', 'le chantier zombie'],
  ], { premiereGras: true, premiereCouleur: '4F46E5', rowH: 0.56 });
  s.addNotes("Synthèse de METHODE §1 et §2, PROMPT-PILOTE (règles 2 et 3) et TEMPLATE-CONTROLE-AVANT-GO. Point commun : le pilote (l'agent qui produit) "
    + "ne valide jamais son propre travail. Il propose ; un tiers — commanditaire, autre modèle, script, recetteur — tranche ou vérifie.");

  s = contenu(pres, 'Les contrepoids', 'La relecture adversariale cherche les failles',
    'Requise après M1, M4 et M6 : un autre modèle relit, avec un prompt fixe, lancé par le pilote.');
  carte(s, K, 0.6, 1.85, 6.7, 4.85, 'prompt de relecture');
  txt(s, 'Le prompt de relecture M1', { x: 0.9, y: 2.0, w: 6.1, h: 0.35, fontSize: 13, bold: true, color: K.indigo });
  s.addShape('roundRect', { x: 0.9, y: 2.42, w: 6.1, h: 4.05, rectRadius: 0.08, fill: { color: 'F3F4F6' }, line: { type: 'none' } });
  txt(s, 'Tu es relecteur adversarial. Lis M1-spec-besoins/ (spec, fiches RG, matrice d\'habilitations) SANS regarder le code du projet.\n'
    + '1) Réexplique le domaine avec tes mots — si tu n\'y arrives pas, la spec échoue sa DoD.\n'
    + '2) Traque : termes non définis ou définis deux fois, RG ambiguës ou sans contre-exemple, habilitations incohérentes, '
    + 'décisions déguisées en descriptions (→ [À ARBITRER]), exigences non fonctionnelles manquantes, COMMENT qui a fui dans le QUOI.\n'
    + 'Rends une liste de défauts priorisée, rien d\'autre.',
  { x: 1.1, y: 2.55, w: 5.7, h: 3.85, fontSize: 12.5, fontFace: 'Courier New', color: K.encre, valign: 'top', paraSpaceAfter: 6 });
  await point(s, K, 'FiUsers', 7.6, 1.95, 5.1, 'Différent en nature', 'un autre modèle (opencode) ou un humain métier. Une autre session du même modèle ne compte pas.', K.violet, 1.0);
  await point(s, K, 'FiEyeOff', 7.6, 3.15, 5.1, 'Sans le code', 'il juge la spec seule : si elle ne se comprend pas sans le code, elle échoue.', K.indigo, 1.0);
  await point(s, K, 'FiArchive', 7.6, 4.35, 5.1, 'Sortie brute archivée', 'dans tracking/relectures/, telle quelle, comme preuve.', K.violet, 1.0);
  await point(s, K, 'FiAlertTriangle', 7.6, 5.55, 5.1, 'Jamais simulée', 'relecteur indisponible ? Le pilote le dit ; il ne se relit pas en se faisant passer pour externe.', K.indigo, 1.1);
  s.addNotes("Prompt tiré de USAGE.md §2 (relecture M1). Règle 3 du PROMPT-PILOTE : relecteur différent en nature, opencode par défaut "
    + "(`opencode run \"Tu es relecteur adversarial…\"`), sortie brute archivée, défauts trouvés et corrigés montrés au commanditaire avec le livrable. "
    + "Pourquoi un autre modèle : un modèle qui relit le texte d'une autre session du même modèle partage ses angles morts (METHODE §1 : « relecture de confort, insuffisante seule »). "
    + "M4 : « chaque décision a-t-elle une raison écrite ? une décision structurante reste-t-elle ouverte ? tout est-il reporté dans la spec ? »");

  s = contenu(pres, 'Les contrepoids', 'Your360 : 47 défauts trouvés avant le code',
    'Un chantier réel (feedback à 360°), relectures opencode des 26, 27 et 30 septembre 2026.');
  stat(s, K, 0.6, 1.95, 2.9, '28', 'défauts relevés sur la spec M1');
  stat(s, K, 3.6, 1.95, 2.9, '17', 'corrigés dans la spec', K.vert);
  stat(s, K, 0.6, 3.55, 2.9, '1', 'transformé en question [À ARBITRER]', K.violet);
  stat(s, K, 3.6, 3.55, 2.9, '10', 'rejetés, chacun avec son motif', K.gris);
  s.addChart(pres.ChartType.bar, [{ name: 'Défauts relevés', labels: ['M1 spec', 'M4 arbitrages', 'M6 plan'], values: [28, 6, 13] }], {
    x: 7.0, y: 1.85, w: 5.7, h: 3.6, barDir: 'col', showTitle: true, title: 'Défauts relevés par relecture', titleFontSize: 14, titleColor: '111827', titleFontFace: '+mn-lt',
    chartColors: ['4F46E5'], showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 13, dataLabelColor: '111827', dataLabelFontFace: '+mn-lt',
    catAxisLabelColor: '6B7280', valAxisLabelColor: '6B7280', catAxisLabelFontSize: 12, valAxisLabelFontSize: 11, catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt',
    valGridLine: { color: 'E5E7EB', size: 0.75 }, catGridLine: { style: 'none' }, showLegend: false, valAxisMaxVal: 30,
  });
  regle(s, K, 'Ce qu\'il a trouvé', 'des règles sans contre-exemple, un droit d\'accès faux, des décisions tranchées en douce dans la matrice : ce qu\'un auteur ne voit pas dans son propre texte.', 5.75, 0.95);
  s.addNotes("Source : APP-28-Your360/docs/chantier/tracking/relectures/ — M1-traitement-relecture.md (28 défauts : 17 corrigés, 1 converti en [À ARBITRER] Q-28, "
    + "10 non retenus avec motif), M4-traitement-relecture.md (6 défauts, 6 traités), M6-traitement-relecture.md (13 défauts, tous sur la cohérence entre livrables). "
    + "Relecteur : opencode avec le modèle MiniMax-M3. Le relecteur a aussi réexpliqué le domaine en dix lignes : la DoD M1 « un tiers comprend » est prouvée.");

  s = contenu(pres, 'Les contrepoids', 'Le relecteur n\'a pas le dernier mot non plus',
    'Chaque défaut reçoit un verdict motivé. Le contrepoids joue dans les deux sens.');
  const verdicts = [
    ['fondé', 'D1FAE5', K.vert, 'B3 · droit d\'accès', 'La matrice interdisait au consultant une séquence qu\'il peut pourtant rattacher à son modèle.', 'Corrigé : accès conditionnel, renvoyé à la règle RG-05.'],
    ['fondé → arbitrage', 'EDE9FE', K.violet, 'M1 · anonymat', '« Anonymat strict » est un réglage de campagne, pas du cabinet. La spec le plaçait au mauvais niveau.', 'Corrigé, et une décision ouverte pour le commanditaire : Q-27.'],
    ['rejeté', 'F3F4F6', K.gris, 'M10 · filtrage par rôle', '« Le filtrage par rôle n\'est pas testé à la passation. »', 'Rejeté : l\'US B5 a déjà ce critère. Le relecteur ne l\'avait pas vue.'],
    ['rejeté', 'F3F4F6', K.gris, 'm11 · import', '« La règle RG-39 n\'a pas de cas d\'import. »', 'Rejeté : l\'import n\'est pas dans le cahier des charges. Zéro invention.'],
  ];
  for (const [i, [v, fond, coul, t, d, r]] of verdicts.entries()) {
    const x = 0.6 + (i % 2) * 6.15, y = 1.85 + Math.floor(i / 2) * 2.05;
    carte(s, K, x, y, 5.95, 1.85, t);
    pastille(s, K, v, x + 0.22, y + 0.2, 2.0, fond, coul);
    txt(s, t, { x: x + 2.4, y: y + 0.2, w: 3.4, h: 0.32, fontSize: 14, bold: true, color: K.encre, valign: 'middle' });
    txt(s, [{ text: d, options: { color: K.gris, breakLine: true } }, { text: r, options: { color: K.encre, bold: true } }],
      { x: x + 0.22, y: y + 0.65, w: 5.5, h: 1.1, fontSize: 13, valign: 'top', paraSpaceAfter: 4 });
  }
  regle(s, K, 'Le partage des rôles', 'le relecteur signale, le pilote juge défaut par défaut en écrivant son motif, le commanditaire voit le tout. Personne ne valide seul.', 6.0, 0.75);
  s.addNotes("Exemples réels tirés de APP-28-Your360/docs/chantier/tracking/relectures/M1-traitement-relecture.md (lignes B3, M1, M10, m11). "
    + "Pourquoi juger chaque défaut : un relecteur LLM se trompe aussi (il n'avait pas vu l'US B5) ou pousse à inventer (un cas d'import absent du CdC). "
    + "Accepter tout sans examen reviendrait à remplacer la complaisance de l'auteur par celle du relecteur. Le fichier de traitement est lui-même archivé.");

  s = contenu(pres, 'Les contrepoids', 'Le doute se voit, puis le commanditaire tranche',
    'Le pilote ne décide rien de structurant : il marque, propose et recommande.');
  const etapes = [
    ['FiFlag', 'Marqué', 'en M1, chaque point non tranché devient [À ARBITRER] dans la spec.'],
    ['FiList', 'Instruit', 'en M4, 2 ou 3 options, leurs avantages, leurs limites, et une recommandation.'],
    ['FiUserCheck', 'Tranché', 'le commanditaire décide, une question à la fois, à l\'arrêt ③.'],
    ['FiEdit3', 'Écrit', 'décision, pourquoi, impact : dans M4 et dans les Révisions de la spec.'],
    ['FiUsers', 'Relu', 'un relecteur vérifie qu\'aucune décision ne reste ouverte ni sans raison.'],
  ];
  for (const [i, [ic, t, d]] of etapes.entries()) {
    const x = 0.6 + i * 2.455, w = 2.2;
    carte(s, K, x, 1.95, w, 3.1, t);
    await tuile(s, K, ic, x + 0.22, 2.17, 0.5, i === 2 ? K.vert : (i % 2 ? K.indigo : K.violet));
    txt(s, (i + 1) + '. ' + t, { x: x + 0.22, y: 2.82, w: w - 0.4, h: 0.4, fontSize: 16, bold: true, color: K.encre });
    txt(s, d, { x: x + 0.22, y: 3.27, w: w - 0.4, h: 1.7, fontSize: 13, color: K.gris, valign: 'top' });
    if (i < 4) fleche(s, K, x + w + 0.02, 3.5, 0.22, 0, K.lavande);
  }
  regle(s, K, 'La règle', 'on ne passe pas au plan tant qu\'une décision structurante est ouverte. Une décision qui n\'est pas écrite n\'est pas prise.', 5.4, 1.1);
  s.addNotes("Sources : METHODE §1·M4, prompt M4 de USAGE.md (« présente-les-moi UNE PAR UNE pour que je tranche »), PROMPT-PILOTE règle 2 (arrêt ③). "
    + "Exemple Your360 : la relecture M4 a trouvé que le pilote avait considéré Q-29 comme « acceptée par le commanditaire » sans que ce soit dit ; "
    + "la question a été reposée au commanditaire à l'arrêt ④. Même logique pour l'arrêt de chantier (§2.4) : le pilote le propose, il ne le décide jamais.");

  s = contenu(pres, 'Les contrepoids', 'Deux contrôleurs qui ne voient pas la même chose',
    'Le relecteur juge le sens ; le script vérifie la mécanique. Ni l\'un ni l\'autre ne suffit seul.');
  carte(s, K, 0.6, 1.85, 5.95, 3.6, 'relecteur');
  await tuile(s, K, 'FiUsers', 0.85, 2.07, 0.55, K.violet);
  txt(s, 'Le relecteur juge', { x: 1.6, y: 2.07, w: 4.8, h: 0.55, fontSize: 18, bold: true, color: K.encre, valign: 'middle' });
  txt(s, [
    { text: 'la cohérence entre livrables', options: { bullet: true, breakLine: true } },
    { text: 'les termes ambigus ou définis deux fois', options: { bullet: true, breakLine: true } },
    { text: 'les décisions déguisées en descriptions', options: { bullet: true, breakLine: true } },
    { text: 'les règles sans contre-exemple', options: { bullet: true, breakLine: true } },
    { text: 'le COMMENT qui fuit dans le QUOI', options: { bullet: true } },
  ], { x: 0.85, y: 2.8, w: 5.5, h: 2.5, fontSize: 14, color: K.encre, valign: 'top', paraSpaceAfter: 6 });
  carte(s, K, 6.75, 1.85, 5.95, 3.6, 'script');
  await tuile(s, K, 'FiTerminal', 7.0, 2.07, 0.55, K.indigo);
  txt(s, 'Le script vérifie', { x: 7.75, y: 2.07, w: 4.8, h: 0.55, fontSize: 18, bold: true, color: K.encre, valign: 'middle' });
  txt(s, [
    { text: 'aucune US sans feature, aucune feature vide', options: { bullet: true, breakLine: true } },
    { text: 'aucune US sans brique, aucune brique sans US', options: { bullet: true, breakLine: true } },
    { text: 'la colonne Tests remplie pour chaque US', options: { bullet: true, breakLine: true } },
    { text: 'chaque guide ou fiche cité existe vraiment', options: { bullet: true, breakLine: true } },
    { text: 'tables, secrets, dépendances conformes', options: { bullet: true } },
  ], { x: 7.0, y: 2.8, w: 5.5, h: 2.5, fontSize: 14, color: K.encre, valign: 'top', paraSpaceAfter: 6 });
  bande(s, 0.6, 5.65, 12.1, 1.05, 'E0E7FF', 'constat');
  txt(s, [{ text: 'Constaté sur Your360 (M6)  ', options: { bold: true, color: K.indigo } },
    { text: 'aucun défaut de couverture, car c\'est vérifié par assertion à chaque exécution ; les 13 défauts trouvés portent tous sur la cohérence entre livrables, ce qu\'aucun script ne sait juger.', options: { color: K.nuit } }],
  { x: 0.9, y: 5.65, w: 11.5, h: 1.05, fontSize: 14, valign: 'middle' });
  s.addNotes("Le générateur gen-fiches-us.py refuse une US sans feature, une feature sans épic et signale les features vides (1.8.0) ; il produit la matrice, les fiches RG "
    + "et les squelettes de tests. controle-avant-go.sh vérifie environ 25 points mécaniques (1.9.0), dont l'existence de chaque référence citée dans la table de routage (1.11). "
    + "Citation : APP-28-Your360/docs/chantier/tracking/relectures/M6-traitement-relecture.md, section « Ce que la relecture n'a pas trouvé ».");

  await B.diapoControle(pres, K, 'Les contrepoids');

  s = contenu(pres, 'Les contrepoids', 'Un écart se corrige ou s\'arbitre, jamais « on verra »',
    'Le contrôle rend un verdict. Un point non vérifié compte comme un écart.');
  const go = [
    ['GO', 'D1FAE5', K.vert, 'FiCheckCircle', 'aucune ligne en écart ni « à vérifier ».'],
    ['GO SOUS RÉSERVE', 'FEF3C7', 'B45309', 'FiAlertCircle', 'chaque écart restant est une décision M4 datée, et aucun ne touche l\'identité, l\'exposition ou les secrets.'],
    ['NO-GO', 'FEE2E2', 'B91C1C', 'FiXCircle', 'tout le reste. On corrige la conception, puis on recontrôle.'],
  ];
  for (const [i, [v, fond, coul, ic, d]] of go.entries()) {
    const x = 0.6 + i * 4.07;
    carte(s, K, x, 1.85, 3.9, 1.95, v);
    s.addShape('roundRect', { x: x + 0.22, y: 2.07, w: 3.46, h: 0.55, rectRadius: 0.1, fill: { color: fond }, line: { type: 'none' } });
    txt(s, v, { x: x + 0.22, y: 2.07, w: 3.46, h: 0.55, fontSize: 17, bold: true, color: coul, align: 'center', valign: 'middle' });
    txt(s, d, { x: x + 0.22, y: 2.75, w: 3.46, h: 1.0, fontSize: 14, color: K.encre, valign: 'top' });
  }
  carte(s, K, 0.6, 4.0, 12.1, 1.55, 'premier essai');
  await tuile(s, K, 'FiTerminal', 0.85, 4.25, 0.55, K.indigo);
  txt(s, [{ text: 'Le script a été éprouvé avant d\'être livré', options: { bold: true, fontSize: 16, color: K.encre, breakLine: true } },
    { text: 'Premier passage sur l\'application Carousel : il a trouvé un écart réel (deux dépendances qui ramenaient Logback au lieu de Log4j2). '
      + 'Il a aussi produit deux faux positifs, corrigés dans le script. Un contrôle qu\'on n\'a jamais vu échouer ne prouve rien.', options: { fontSize: 14, color: K.gris } }],
  { x: 1.6, y: 4.2, w: 10.9, h: 1.3, valign: 'top', paraSpaceAfter: 4 });
  regle(s, K, 'Non négociables', 'identité, exposition et secrets : un écart sur ces trois familles est toujours un no-go.', 5.8, 0.9);
  s.addNotes("Source : TEMPLATE-CONTROLE-AVANT-GO.md, section Conclusion, et CHANGELOG 1.9.0. Les sections 2 (identité), 3 (exposition) et 4 (secrets) ne se négocient pas : "
    + "elles ne peuvent pas passer en « go sous réserve ». Pourquoi ce contrôle : avant 1.9.0, l'arrêt ⑥ était devenu une formalité ; un chantier pouvait arriver au code "
    + "avec une nomenclature de tables hors standard, une autorisation fondée sur un rôle que le SSO n'injecte pas, ou une API exposée hors APIM.");

  s = contenu(pres, 'Les contrepoids', 'Quand le réel contredit le papier',
    'La chaîne se lit de gauche à droite, mais le réel remonte. Quatre procédures l\'encadrent.');
  const boucles = [
    ['FiXOctagon', 'Une gate échoue', 'La phase ne se ferme pas. L\'échec est consigné, puis une décision écrite : refaire la démo, retirer des US, ou revenir à M4 ou M6.'],
    ['FiCornerUpLeft', 'Un livrable amont est faux', 'La spec gagne une entrée datée dans ses Révisions, la ligne de la matrice est mise à jour avec sa date.'],
    ['FiGitMerge', 'Une US change', 'Elle peut être découpée ou abandonnée, jamais supprimée : elle reste dans la matrice, barrée, avec sa raison.'],
    ['FiPower', 'Le chantier patine', 'Deux gates ajournées sur la même phase : le pilote propose l\'arrêt, le commanditaire tranche, un retour d\'expérience suit.'],
  ];
  for (const [i, [ic, t, d]] of boucles.entries()) {
    const x = 0.6 + i * 3.07;
    await carteTexte(s, K, x, 1.85, 2.9, 3.75, ic, t, d, i === 3 ? K.nuit : (i % 2 ? K.indigo : K.violet), 13.5);
  }
  regle(s, K, 'Pourquoi', 'un plan qui ne se met pas à jour devient faux en silence. Et un chantier arrêté proprement vaut mieux qu\'un chantier zombie.', 5.85, 0.85);
  s.addNotes("Source : METHODE §2.1 à §2.4 (boucles de retour ajoutées en 1.1.0, arrêt de chantier en 1.7.0). Les artefacts d'un chantier arrêté sont archivés, jamais effacés.");

  // ================================================================ 03 Les tests
  intercalaire(pres, 'Les tests', '03', 'Les tests', 'Chaque promesse a sa preuve, écrite avant le code et rejouée à chaque phase.',
    "Partie 3 : comment la méthode met les tests en place. Source principale : conception/TEMPLATE-TESTS.md et METHODE §1·M6.5 et §1·M7.");
  await B.diapoPreuve(pres, K, 'Les tests');

  s = contenu(pres, 'Les tests', 'Les tests suivent les axes de la méthode',
    'Chaque type de promesse a son type de preuve, et une étiquette qui rend la couverture calculable.');
  tableau(s, K, 0.6, 1.8, [2.4, 4.6, 2.0, 3.1], [
    ['Ce qu\'on prouve', 'Le test', 'Étiquette', 'Écrit'],
    ['Une user story', 'test d\'acceptation, par l\'API', '@US-x', 'critères en M2, test en phase'],
    ['Une règle de gestion', 'deux scénarios : le cas conforme et le cas rejeté', '@RG-x', 'depuis sa fiche M1'],
    ['Un droit refusé', 'test négatif (403) et étanchéité entre tenants', '@neg', 'depuis la matrice des droits'],
    ['Une brique', 'tests unitaires, avec le code', '—', 'en phase'],
    ['Un écran', 'parcours au navigateur, dans le rôle, fenêtre réelle', '@pivot', 'M6, joué à la gate'],
    ['Une phase', 'la gate en une commande + toutes les phases précédentes', 'toutes', 'rapport archivé'],
    ['Une sauvegarde', 'sa restauration, exécutée', '—', 'pilier run'],
  ], { premiereGras: true, premiereCouleur: '4F46E5', rowH: 0.56 });
  s.addNotes("Source : TEMPLATE-TESTS.md §1 et METHODE §1·M6.5 (plan de test aligné sur les axes depuis 1.4.0, axe écran depuis 1.10.0). "
    + "Doctrine : jamais « une US = des tests unitaires » ; l'US se prouve par acceptation, la règle par son contre-exemple, la brique par ses unitaires. "
    + "Les étiquettes @US-x, @RG-x, @neg, @pivot et @feat-x rendent la couverture calculable par la CI. La restauration d'une sauvegarde relève du pilier run (EXPLOITATION).");

  s = contenu(pres, 'Les tests', 'Les droits signés par le métier deviennent des tests',
    'La matrice rôle × user story est signée en M1 ; chaque case produit sa preuve.');
  const roles = ['', 'Consultant', 'Manager', 'Bénéficiaire'];
  const cases = [['US-12 · lancer une campagne', 'oui', 'oui', 'non'], ['US-14 · lire une synthèse', 'si', 'oui', 'si'], ['US-20 · exporter les réponses', 'non', 'oui', 'non']];
  const SYM = { oui: ['D1FAE5', '059669', 'oui'], non: ['FEE2E2', 'B91C1C', 'non'], si: ['FEF3C7', 'B45309', 'si…'] };
  const sym = (k, x, y) => pastille(s, K, SYM[k][2], x, y, 0.8, SYM[k][0], SYM[k][1]);
  const cw = [3.0, 1.35, 1.35, 1.5];
  const ligne = (r, j) => { let x = 0.6; r.forEach((c, k) => {
    const w = cw[k], y = 1.95 + j * 0.62;
    s.addShape('rect', { x, y, w, h: 0.62, fill: { color: j === 0 ? '4F46E5' : 'FFFFFF' }, line: { color: BORD, width: 0.75 } });
    if (j > 0 && k > 0) sym(c, x + (w - 0.8) / 2, y + 0.15);
    else txt(s, c, { x: x + 0.08, y, w: w - 0.16, h: 0.62, fontSize: 13, bold: j === 0, color: j === 0 ? K.blanc : K.encre, align: k === 0 ? 'left' : 'center', valign: 'middle' });
    x += w; }); };
  ligne(roles, 0); cases.forEach((r, j) => ligne(r, j + 1));
  txt(s, 'exemple', { x: 0.6, y: 4.5, w: 3, h: 0.25, fontSize: 10, italic: true, color: K.gris });
  const lect = [['oui', 'autorisé', 'un test d\'acceptation dans ce rôle', K.vert], ['non', 'interdit', 'un test négatif (403) et un test d\'étanchéité entre tenants', 'B91C1C'],
    ['si', 'sous condition', 'une règle de gestion « droit d\'accès » et ses deux scénarios', 'B45309']];
  for (const [i, [sym0, n, d, c]] of lect.entries()) {
    const y = 1.95 + i * 0.95;
    carte(s, K, 8.1, y, 4.6, 0.8, n);
    sym(sym0, 8.25, y + 0.24);
    txt(s, [{ text: n, options: { bold: true, color: c, breakLine: true } }, { text: d, options: { color: K.encre } }], { x: 9.2, y, w: 3.4, h: 0.8, fontSize: 12.5, valign: 'middle' });
  }
  regle(s, K, 'La doctrine', 'les grands rôles vivent dans l\'IAM du Hub ; les conditions fines sont des règles de gestion dans le code. Aucune case « ? » au moment de signer.', 5.0, 1.0);
  s.addNotes("Source : TEMPLATE-HABILITATIONS.md (1.4.0). Acteur ≠ rôle ; toujours un rôle administrateur du tenant. La matrice générée est qualifiée jusqu'à ne plus avoir "
    + "de « ? » (arrêt ② : « besoins signés : règles et droits, zéro ? »). En M6, les rôles sont projetés sur les rôles et scopes du manifest.json. "
    + "Le contrôle avant go vérifie (2.6) qu'aucune autorisation ne repose sur un rôle SSO : le SSO n'injecte aucun rôle. L'exemple de matrice est illustratif.");

  s = contenu(pres, 'Les tests', 'Les tests naissent en trois temps, avant le code',
    'Au moment du go, chaque user story a déjà son test nommé dans la matrice.');
  const temps = [
    ['M2', 'Les critères', 'Chaque user story reçoit ses critères d\'acceptation. Une US qu\'on ne sait pas tester est réécrite.', 'FiEdit3'],
    ['M6', 'Le plan', 'Plan de test par phase, squelettes Gherkin générés (un scénario par critère, deux par règle), colonne Tests de la matrice remplie.', 'FiClipboard'],
    ['P-x', 'Le code et la gate', 'Les squelettes deviennent des tests. La gate lance en une commande la phase, les négatifs et les phases précédentes ; le rapport est archivé.', 'FiPlayCircle'],
  ];
  s.addShape('line', { x: 1.5, y: 2.35, w: 10.3, h: 0, line: { color: K.lavande, width: 2 } });
  for (const [i, [m, t, d, ic]] of temps.entries()) {
    const x = 0.6 + i * 4.07;
    rond(s, K, m, x + 1.6, 2.0, 0.7, i === 2 ? K.vert : K.indigo, 14);
    await carteTexte(s, K, x, 2.95, 3.9, 2.75, ic, t, d, i === 2 ? K.vert : K.violet, 13.5);
  }
  regle(s, K, 'Contrôlé', 'avant le go, le script refuse une matrice dont une US n\'a pas de test. À la gate, le rapport de tests est la preuve, archivé dans le suivi de la phase.', 5.9, 0.85);
  s.addNotes("Sources : README racine « vue globale » (1.3.0, entrée des tests en trois temps), générateur (squelettes Gherkin dans tests-squelettes/, 1.4.0), "
    + "TEMPLATE-TESTS §4 (la gate en une commande, rapport archivé dans tracking/P-x/), contrôle avant go point 8.3 (colonne Tests remplie, vérifié par le script). "
    + "Exemple réel : la gate P-8 de Your360 a tourné 202 tests d'acceptation, 0 échec, 1 ignoré (tracking/P-8).");

  s = contenu(pres, 'Les tests', 'Un écran se prouve dans le rôle, dans une vraie fenêtre',
    'Leçon de Your360 : 202 tests de services au vert, et cinq défauts d\'écran trouvés en une soirée.');
  bande(s, 0.6, 1.85, 5.6, 4.85, K.nuit, 'constat Your360');
  txt(s, '202', { x: 0.9, y: 2.0, w: 2.4, h: 0.85, fontSize: 48, bold: true, color: K.lavande, valign: 'bottom' });
  txt(s, 'tests verts', { x: 0.9, y: 2.85, w: 2.4, h: 0.35, fontSize: 14, color: K.blanc });
  txt(s, '5', { x: 3.4, y: 2.0, w: 2.4, h: 0.85, fontSize: 48, bold: true, color: 'FCA5A5', valign: 'bottom' });
  txt(s, 'défauts d\'écran', { x: 3.4, y: 2.85, w: 2.5, h: 0.35, fontSize: 14, color: K.blanc });
  txt(s, [
    { text: 'un bouton « Créer » sans effet', options: { bullet: true, breakLine: true } },
    { text: 'un texte figé qui promettait l\'anonymat sur une campagne signée', options: { bullet: true, breakLine: true } },
    { text: 'un bouton absent dans un état de campagne', options: { bullet: true, breakLine: true } },
    { text: 'un questionnaire envoyé sans issue', options: { bullet: true, breakLine: true } },
    { text: 'un panneau sans ascenseur, que vingt captures pleine page montraient entier', options: { bullet: true } },
  ], { x: 0.9, y: 3.4, w: 5.1, h: 3.2, fontSize: 13, color: K.blanc, valign: 'top', paraSpaceAfter: 5 });
  txt(s, 'La liste fixe de la gate d\'écran', { x: 6.5, y: 1.85, w: 6.2, h: 0.35, fontSize: 15, bold: true, color: K.encre });
  const liste = [['FiUser', 'Dans le rôle', 'connecté comme la personne, jamais par un raccourci de pilote'],
    ['FiMaximize', 'Dans une fenêtre réelle', '1280 × 900 ; l\'E2E descend jusqu\'au dernier élément'],
    ['FiToggleRight', 'Chaque état a un bouton', 'ou dit pourquoi il n\'y en a pas'],
    ['FiLogOut', 'Chaque étape a une sortie', '« et maintenant, où je clique ? »'],
    ['FiType', 'Le texte dit l\'état réel', 'un texte figé qui contredit l\'état est un défaut']];
  for (const [i, [ic, t, d]] of liste.entries()) await point(s, K, ic, 6.5, 2.35 + i * 0.88, 6.2, (i + 1) + '. ' + t, d, i % 2 ? K.indigo : K.violet, 0.85);
  s.addNotes("Source : CHANGELOG 1.10.0 et METHODE §1·M7 (liste fixe de la gate d'écran). RETEX Your360 (APP-28), gate P-8 jouée par le commanditaire le 2026-10-26 : "
    + "les cinq défauts ont été trouvés par le commanditaire ou par la suite Playwright en jouant la chaîne, aucun par les tests de services. "
    + "Règle qui en découle : une US d'écran a deux preuves (services et parcours au navigateur), et une capture pleine page n'est pas une preuve : elle rend ce que personne ne peut atteindre.");

  s = contenu(pres, 'Les tests', 'Zéro simulation : un état honnête plutôt qu\'un faux vert',
    'Un test qui passe grâce à un bouchon prouve que le bouchon marche.');
  carte(s, K, 0.6, 1.85, 5.95, 3.8, 'interdit');
  await tuile(s, K, 'FiXCircle', 0.85, 2.07, 0.55, 'B91C1C');
  txt(s, 'Ce qui est interdit', { x: 1.6, y: 2.07, w: 4.8, h: 0.55, fontSize: 18, bold: true, color: K.encre, valign: 'middle' });
  txt(s, [
    { text: 'un bouchon à la place d\'une dépendance réelle', options: { bullet: true, breakLine: true } },
    { text: 'une fausse donnée « en dur pour l\'instant »', options: { bullet: true, breakLine: true } },
    { text: 'un résultat inventé quand le service manque', options: { bullet: true, breakLine: true } },
    { text: 'une case cochée à la place d\'une démo', options: { bullet: true } },
  ], { x: 0.85, y: 2.85, w: 5.5, h: 2.7, fontSize: 14, color: K.encre, valign: 'top', paraSpaceAfter: 8 });
  carte(s, K, 6.75, 1.85, 5.95, 3.8, 'exigé');
  await tuile(s, K, 'FiCheckCircle', 7.0, 2.07, 0.55, K.vert);
  txt(s, 'Ce qui est exigé', { x: 7.75, y: 2.07, w: 4.8, h: 0.55, fontSize: 18, bold: true, color: K.encre, valign: 'middle' });
  txt(s, [
    { text: 'les tests tournent contre la vraie base et les vrais services', options: { bullet: true, breakLine: true } },
    { text: 'sans dépendance réelle : l\'état « en attente », affiché tel quel', options: { bullet: true, breakLine: true } },
    { text: 'un test ignoré est déclaré, compté, expliqué', options: { bullet: true, breakLine: true } },
    { text: 'ce qui n\'est pas faisable est écrit comme tel', options: { bullet: true } },
  ], { x: 7.0, y: 2.85, w: 5.5, h: 2.7, fontSize: 14, color: K.encre, valign: 'top', paraSpaceAfter: 8 });
  regle(s, K, 'Pourquoi', 'un faux vert est pire qu\'un rouge : il fait livrer ce qui ne marche pas, et il fait perdre confiance dans tous les autres tests.', 5.85, 0.85);
  s.addNotes("Source : ESSENTIEL.md §5, METHODE §4 (« aucun mock, aucune simulation, aucune régression »), TEMPLATE-TESTS (« un test sans dépendance réelle disponible = état honnête "
    + "en_attente, jamais un faux vert »), contrôle avant go section 9 (clause qualité LMVI).");

  // ================================================================ 04 Ce qui a été fait, et pourquoi
  intercalaire(pres, 'Historique', '04', 'Ce qui a été fait, et pourquoi', 'Chaque règle de la méthode est née d\'un problème constaté sur un chantier réel.',
    "Partie 4 : l'historique du kit, du 2026-07-05 au 2026-10-28. Source : docs/methode-lmvi/CHANGELOG.md et les tags git v1.1.0 à v1.16.0.");

  s = contenu(pres, 'Historique', 'Quatre mois, seize versions',
    'Du 5 juillet au 28 octobre 2026 : chaque version répond à un constat.');
  const jalons = [
    ['1.0', '5 juil.', 'Distillée de Régie : chaîne M0→M7, gabarits, générateur'],
    ['1.1', '6 juil.', 'Revue critique : un artefact = un axe, boucles de retour'],
    ['1.4', '6 juil.', 'Règles en fiches, matrice des droits, plan de test'],
    ['1.4.3', '6 juil.', 'Le prompt pilote et ses six arrêts'],
    ['1.5–1.6', '6 juil.', 'Piliers conformité (recette, RGPD) et run'],
    ['1.7', '6 juil.', 'Preuve externe, relecteur d\'un autre modèle, profils, gel'],
    ['1.8', '22 juil.', 'Niveau Feature : Épic → Feature → US'],
    ['1.9', '22 sept.', 'Contrôle avant go et son script'],
    ['1.10', '26 oct.', 'La preuve d\'un écran'],
    ['1.11–1.12', '27 oct.', 'Le routage : 44 guides, 148 fiches'],
    ['1.13–1.16', '28 oct.', 'Les packs : service-pack first'],
  ];
  const rangs = [jalons.slice(0, 6), jalons.slice(6)];
  rangs.forEach((rang, r) => {
    const y = 1.95 + r * 2.4, pas = 12.1 / 6;
    s.addShape('line', { x: 0.6 + pas / 2, y: y + 0.28, w: pas * (rang.length - 1), h: 0, line: { color: K.lavande, width: 2 } });
    rang.forEach(([v, d, t], i) => {
      const cx = 0.6 + i * pas + pas / 2;
      s.addShape('roundRect', { x: cx - 0.6, y, w: 1.2, h: 0.56, rectRadius: 0.12, fill: { color: r === 1 && i >= 2 ? K.violet : K.indigo }, line: { color: 'FFFFFF', width: 2 } });
      txt(s, v, { x: cx - 0.6, y, w: 1.2, h: 0.56, fontSize: 14, bold: true, color: K.blanc, align: 'center', valign: 'middle' });
      txt(s, d, { x: cx - pas / 2, y: y + 0.62, w: pas, h: 0.28, fontSize: 11, color: K.gris, align: 'center' });
      txt(s, t, { x: cx - pas / 2 + 0.08, y: y + 0.92, w: pas - 0.16, h: 1.0, fontSize: 12.5, color: K.encre, align: 'center', valign: 'top' });
    });
  });
  s.addNotes("Source : CHANGELOG.md. Le 6 juillet concentre la construction initiale (1.1 à 1.7) à partir de la revue critique AnalyseFable ; après 1.7.0 le kit est gelé "
    + "et la règle devient « une version = un retour d'expérience de chantier réel ». Les versions suivantes répondent chacune à un constat de chantier : "
    + "contrat d'architecture périmé (1.9), défauts d'écran de Your360 (1.10), services réécrits (1.11), packs (1.13 à 1.16). 27 tags git publiés, de v1.1.0 à v1.16.0.");

  s = contenu(pres, 'Historique', 'Chaque règle a sa cicatrice',
    'Ce qu\'on a constaté, la règle qui y répond, et la version qui l\'a introduite.');
  tableau(s, K, 0.6, 1.8, [5.35, 5.35, 1.4], [
    ['Ce qu\'on a constaté', 'La règle ajoutée', 'Version'],
    ['Sur Régie, la fiche US portait phase et brique : chaque changement de plan réécrivait le métier', 'un artefact = un axe ; la matrice est la seule source du lien', '1.1'],
    ['Une spec relue par son auteur, ou par le même modèle, ne trouve pas ses trous', 'relecteur différent en nature, sortie brute archivée', '1.7'],
    ['Une méthode déroulée sur un correctif se fait contourner', 'profils et seuil d\'entrée', '1.7'],
    ['L\'arrêt ⑥ était devenu une formalité ; 4 règles du contrat étaient périmées', 'contrôle avant go, script, contrat corrigé', '1.9'],
    ['Your360 : 202 tests verts, 5 défauts d\'écran', 'preuve d\'écran, liste fixe de la gate', '1.10'],
    ['Un agent réécrivait un service que le Hub rend déjà', 'routage en trois catalogues, NON COUVERT', '1.11'],
    ['Des applications recodaient ce qu\'un pack fait déjà', 'service-pack first : on amende le pack', '1.13'],
  ], { rowH: 0.56, taille: 12.5 });
  s.addNotes("Sources, dans l'ordre : CHANGELOG 1.1.0 (Option A, décision du commanditaire), 1.7.0 (T-4 relecteur hors-famille, T-2/T-3 profils et seuil), "
    + "1.9.0 (quatre règles périmées : propriétaire des tables, trigger BEFORE UPDATE, IP dans target_host, port du dashboard), 1.10.0 (RETEX Your360), "
    + "1.11.0 (« c'est au plan technique qu'un agent réécrit un service que la plateforme rend déjà »), 1.13.0 (CATALOGUE-PACKS et règle service-pack first).");

  s = contenu(pres, 'Historique', 'La méthode se soumet à ses propres règles',
    'Le kit est lui-même relu par un tiers, et ne se dit prouvé que par un chantier réel.');
  const auto = [
    ['FiSearch', 'Une revue critique', 'Six documents d\'analyse (AnalyseFable) et un plan de corrections C-1 à C-8, à l\'origine de la 1.1.'],
    ['FiUsers', 'Relue par un autre modèle', 'La page ESSENTIEL relue par MiniMax-M3 : 15 défauts, dont 6 bloquants, classés P0 à P2.'],
    ['FiTag', 'Ce qui n\'est pas prouvé le dit', 'Chaque gabarit porte PROUVÉ-SUR ; une règle issue d\'un seul chantier est marquée ⚗️ candidate.'],
    ['FiLock', 'Gel et retour d\'expérience', 'Kit gelé pendant un chantier, frictions notées à chaud ; une version = un retour d\'expérience.'],
  ];
  for (const [i, [ic, t, d]] of auto.entries()) {
    const x = 0.6 + i * 3.07;
    await carteTexte(s, K, x, 1.85, 2.9, 3.75, ic, t, d, i % 2 ? K.indigo : K.violet, 13.5);
  }
  regle(s, K, 'La preuve du kit', 'un gabarit jamais utilisé sur un vrai chantier reste « non prouvé », quelle que soit la qualité de sa rédaction.', 5.85, 0.85);
  s.addNotes("Sources : docs/methode-lmvi/AnalyseFable/ (01-ANALYSE à 06-PLAN-TRANSFORMATION), AnalyseFable/preuves/relecture-opencode-essentiel.md "
    + "(relecture réelle par opencode / MiniMax-M3, 2026-07-06 : 6 défauts P0, 5 P1, 4 P2), CHANGELOG 1.7.0 (T-5 : marqueur PROUVE-SUR sur les 25 gabarits, "
    + "KIT-FRICTIONS.md tenu par le pilote, gel jusqu'au retour d'expérience BilanSocle). METHODE §0.1 : la preuve externe du kit est un chantier réel.");

  s = contenu(pres, 'Historique', 'Où en est la méthode aujourd\'hui',
    'Kit 1.16.0, appliqué sur les chantiers du dépôt TheHub4TheSocle.');
  const chiffres = [['19', 'chantiers pilotés avec leur journal de pilotage'], ['160', 'fichiers de relecture archivés'], ['27', 'versions publiées, de 1.1.0 à 1.16.0'],
    ['44', 'guides de service du Hub'], ['148', 'fiches de mécanisme du Socle'], ['61', 'guides pour les 8 packs']];
  for (const [i, [n, l]] of chiffres.entries()) {
    const x = 0.6 + (i % 3) * 4.07, y = 1.85 + Math.floor(i / 3) * 2.05;
    carte(s, K, x, y, 3.9, 1.85, l);
    stat(s, K, x + 0.3, y + 0.2, 3.3, n, l, i < 3 ? K.indigo : K.violet);
  }
  regle(s, K, 'Les catalogues', 'les 44 guides, les 61 guides de packs et les 148 fiches voyagent avec le kit : chaque chantier sait où vérifier avant d\'écrire une brique.', 6.0, 0.75);
  s.addNotes("Mesuré le 2026-11-03 dans le dépôt : 19 dossiers docs/chantier/PILOTAGE.md, 19 dossiers tracking/relectures totalisant 160 fichiers "
    + "(dont 64 pour KlaxSocle et 37 pour TheDash), 27 tags git dans docs/methode-lmvi. Catalogues : CATALOGUE-SERVICES (44 guides, 1.11.1), "
    + "CATALOGUE-MECANISMES (148 fiches, 1.11.3), CATALOGUE-PACKS (61 howtos pour 8 packs, 1.13.0).");

  // ================================================================ Clôture
  pres.addSection({ title: 'Clôture' });
  s = pres.addSlide({ masterName: 'SOMBRE', sectionTitle: 'Clôture' });
  s.addImage({ path: path.join(__dirname, '..', '_images', 'logo-blanc.png'), x: 0.8, y: 0.8, w: 0.55, h: 0.55, altText: 'Logo TheSocle' });
  txt(s, 'TheSocle', { x: 1.5, y: 0.8, w: 4, h: 0.55, fontSize: 24, bold: true, color: K.blanc, valign: 'middle' });
  s.addText('Décider avant, prouver toujours', { placeholder: 'title' });
  s.addText('Aucune décision ne se valide seule, aucune promesse sans sa preuve, aucune règle sans sa raison.', { placeholder: 'chapo' });
  const lire = [['ESSENTIEL.md', 'la philosophie en une page'], ['USAGE.md', 'démarrer un chantier, prompts par maillon'],
    ['conception/METHODE-Besoin2Plan.md', 'la référence complète'], ['CHANGELOG.md', 'chaque version et sa raison']];
  txt(s, 'Pour aller plus loin · docs/methode-lmvi', { x: 8.6, y: 1.7, w: 4.2, h: 0.4, fontSize: 14, bold: true, color: K.lavande });
  lire.forEach(([f, d], i) => {
    const y = 2.2 + i * 1.0;
    s.addShape('roundRect', { x: 8.6, y, w: 4.2, h: 0.85, rectRadius: 0.12, fill: { color: '312E81' }, line: { type: 'none' } });
    txt(s, [{ text: f, options: { bold: true, color: K.blanc, breakLine: true } }, { text: d, options: { color: K.lavande } }], { x: 8.8, y, w: 3.9, h: 0.85, fontSize: 13, valign: 'middle' });
  });
  txt(s, 'Version publique générique : github.com/Lmvi-Conseil/besoin2plan', { x: 0.8, y: 6.5, w: 7, h: 0.35, fontSize: 12, color: K.lavande });
  s.addNotes("Le kit canonique : docs/methode-lmvi (github.com/jmlmvi/methode-lmvi), version 1.16.0. Une version générique est publique : github.com/Lmvi-Conseil/besoin2plan. "
    + "Pour démarrer un chantier : la skill /besoin2plan, qui monte le chantier et déroule le PROMPT-PILOTE.");

  await pres.writeFile({ fileName: SORTIE });
  await applyTheme(SORTIE, THEME);
  console.log('écrit :', SORTIE);
}

function stat(s, K, x, y, w, nombre, libelle, couleur) {
  txt(s, nombre, { x, y, w, h: 0.8, fontSize: 40, bold: true, color: couleur || K.indigo, valign: 'bottom' });
  txt(s, libelle, { x, y: y + 0.84, w, h: 0.6, fontSize: 14, color: K.gris, valign: 'top' });
}

construire().catch(e => { console.error(e); process.exit(1); });
