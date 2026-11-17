// Les diapositives qui expliquent les couches (B1-B5) et la méthode Besoin→Plan (D1-D5).
// Voir ../PROPOSITIONS-COUCHES.md, validé le 2026-11-03.
const { icone, tuile, carte, pastille } = require('./commun');

const BORD = 'E5E7EB';

function titreDiapo(pres, section, titre, chapo) {
  const s = pres.addSlide({ masterName: 'CONTENU', sectionTitle: section });
  s.addText(titre, { placeholder: 'title' });
  if (chapo) s.addText(chapo, { placeholder: 'chapo' });
  return s;
}
function txt(s, t, o) { s.addText(t, Object.assign({ margin: 0, isTextBox: true }, o)); }
function bande(s, K, x, y, w, h, fond, nom) {
  s.addShape('roundRect', { x, y, w, h, rectRadius: 0.12, fill: { color: fond }, line: { type: 'none' }, objectName: nom });
}
function fleche(s, K, x, y, w, h, couleur) {
  s.addShape('line', { x, y, w, h, line: { color: couleur || K.indigo, width: 2, endArrowType: 'triangle' } });
}
function lettre(s, K, l, x, y, t, fond) {
  s.addShape('roundRect', { x, y, w: t, h: t, rectRadius: t * 0.22, fill: { color: fond || K.violet }, line: { type: 'none' } });
  txt(s, l, { x, y, w: t, h: t, fontSize: 18, bold: true, color: K.blanc, align: 'center', valign: 'middle' });
}
function rond(s, K, texte, x, y, d, fond, taille) {
  s.addShape('ellipse', { x, y, w: d, h: d, fill: { color: fond || K.indigo }, line: { color: 'FFFFFF', width: 2 } });
  txt(s, texte, { x, y, w: d, h: d, fontSize: taille || 14, bold: true, color: K.blanc, align: 'center', valign: 'middle' });
}
// Couleur de chaque couche, réutilisée partout pour que l'œil les reconnaisse.
const couleurs = K => ({ SOCLE: K.nuit, PACK: K.violet, HUB: K.indigo, VOUS: K.vert });

// ---------------------------------------------------------------- B2. Tout est fait du même Socle
async function diapoMemeSocle(pres, K, section) {
  const s = titreDiapo(pres, section, 'Tout est construit sur le même Socle, la plateforme comprise',
    "Le Hub n'est pas une couche de plus : c'est une application du Socle, qui fait tourner les autres.");
  // Le Socle, en bas
  bande(s, K, 0.6, 5.6, 12.1, 1.05, K.nuit, 'socle');
  await tuile(s, K, 'FiLayers', 0.85, 5.8, 0.65, K.indigo);
  txt(s, [{ text: 'Le Socle V005', options: { bold: true, fontSize: 18, color: K.blanc, breakLine: true } },
    { text: 'les mêmes fondations sous chaque programme : workers supervisés, actions MCP et REST, tableau de bord', options: { fontSize: 14, color: K.lavande } }],
  { x: 1.7, y: 5.6, w: 10.8, h: 1.05, valign: 'middle' });
  // Le Hub
  bande(s, K, 0.6, 1.9, 3.6, 3.25, K.indigo, 'hub');
  await tuile(s, K, 'FiServer', 0.85, 2.12, 0.6, K.nuit);
  txt(s, 'Le Hub', { x: 0.85, y: 2.85, w: 3.1, h: 0.45, fontSize: 20, bold: true, color: K.blanc });
  txt(s, [{ text: 'Socle', options: { breakLine: true } }, { text: '+ 59 workers de plateforme', options: { breakLine: true } },
    { text: 'identité, domaines, courrier, coffre, stockage, IA, sauvegardes', options: { color: K.pale, breakLine: true } },
    { text: '→ installe, protège et sert les applications', options: { bold: true, color: K.blanc } }],
  { x: 0.85, y: 3.35, w: 3.15, h: 1.7, fontSize: 14, color: K.blanc, valign: 'top' });
  // Trois applications réelles, avec les packs qu'elles embarquent vraiment
  const apps = [
    ['V', 'Veille', ['Socle', '+ packs IA, éditorial, pipeline, communication, sortie réseau', '+ son code métier']],
    ['T', 'TheDiffuseur', ['Socle', '+ packs IA, pipeline', '+ son code métier']],
    ['E', 'Entreprises', ['Socle', 'aucun pack : il n\'en avait pas besoin', '+ son code métier']],
  ];
  apps.forEach(([l, n, lignes], i) => {
    const x = 5.0 + i * 2.6;
    carte(s, K, x, 1.9, 2.45, 3.25, n);
    lettre(s, K, l, x + 0.22, 2.12, 0.55);
    txt(s, n, { x: x + 0.22, y: 2.85, w: 2.1, h: 0.45, fontSize: 17, bold: true, color: K.encre });
    txt(s, lignes.map((t, j) => ({ text: t, options: { breakLine: j < lignes.length - 1, color: j === 1 ? K.violet : K.gris, bold: j === 1 } })),
      { x: x + 0.22, y: 3.35, w: 2.05, h: 1.7, fontSize: 13, valign: 'top', paraSpaceAfter: 3 });
  });
  // Liens vers le Socle, et le Hub qui sert les applications
  [2.4, 6.22, 8.82, 11.42].forEach(x => s.addShape('line', { x, y: 5.17, w: 0, h: 0.4, line: { color: K.lavande, width: 2 } }));
  fleche(s, K, 4.28, 3.5, 0.62, 0, K.indigo);
  s.addNotes("Le déclic à faire passer : tout est fait du même Socle, la plateforme comprise. Le Hub (soclehub) est une application V005 "
    + "comme les autres, avec 59 workers de plateforme (inventaire du 2026-10-28). Il installe les applications, les protège (proxy, identité) "
    + "et leur fournit ses services. Packs réellement embarqués, lus dans les pom.xml au 2026-11-03 : Veille (RssArchiver) ai, comm, editorial, "
    + "egress, pipeline ; TheDiffuseur ai, pipeline ; Entreprises aucun. Conséquence : ce qu'on éprouve sur le Hub profite à chaque application, et inversement.");
  return s;
}

// ---------------------------------------------------------------- B1. Fabriquer, puis faire tourner
async function diapoFabriquer(pres, K, section, titre) {
  const s = titreDiapo(pres, section, titre || 'On fabrique une application, puis on la fait tourner',
    'Deux moments, deux lieux : dans l\'usine, une fois ; chez vous, tous les jours.');
  // FABRIQUER
  txt(s, [{ text: 'FABRIQUER', options: { bold: true, color: K.indigo, breakLine: true } }, { text: "dans l'usine, une fois", options: { color: K.gris } }],
    { x: 0.6, y: 1.8, w: 4.4, h: 0.6, fontSize: 14 });
  const pile = [['Votre code métier', 'règles · écrans · données', K.vert, K.blanc, 'D1FAE5'],
    ['Les packs choisis', 'IA · courrier · connecteurs · pipeline…', K.violet, K.blanc, 'DDD6FE'],
    ['Le Socle V005', 'les fondations communes', K.nuit, K.blanc, 'A5B4FC']];
  pile.forEach(([t, d, f], i) => {
    const y = 2.5 + i * 1.08;
    bande(s, K, 0.6, y, 4.4, 0.98, f, t);
    txt(s, [{ text: t, options: { bold: true, fontSize: 16, color: K.blanc, breakLine: true } }, { text: d, options: { fontSize: 13, color: K.blanc } }],
      { x: 0.85, y, w: 4.0, h: 0.98, valign: 'middle' });
  });
  pastille(s, K, '= UNE APPLICATION', 0.6, 5.85, 4.4);
  // La flèche : une image au registre
  fleche(s, K, 5.15, 4.0, 1.0, 0, K.indigo);
  txt(s, 'une image signée, au registre', { x: 5.05, y: 4.12, w: 1.2, h: 0.75, fontSize: 11, italic: true, color: K.indigo, align: 'center' });
  // FAIRE TOURNER
  txt(s, [{ text: 'FAIRE TOURNER', options: { bold: true, color: K.indigo, breakLine: true } }, { text: 'chez vous, tous les jours', options: { color: K.gris } }],
    { x: 6.3, y: 1.8, w: 6.4, h: 0.6, fontSize: 14 });
  s.addShape('roundRect', { x: 6.3, y: 2.5, w: 6.4, h: 3.2, rectRadius: 0.12, fill: { color: K.blanc }, line: { color: K.indigo, width: 2 }, objectName: 'votre hub' });
  txt(s, 'Votre Hub', { x: 6.55, y: 2.62, w: 3, h: 0.4, fontSize: 17, bold: true, color: K.indigo });
  ['A', 'B', 'C', '…'].forEach((l, i) => {
    const x = 6.75 + i * 1.47;
    lettre(s, K, l, x, 3.15, 0.8, i === 3 ? K.lavande : K.violet);
    s.addShape('line', { x: x + 0.4, y: 3.97, w: 0, h: 0.4, line: { color: K.lavande, width: 1.5 } });
  });
  s.addShape('line', { x: 7.15, y: 4.37, w: 4.41, h: 0, line: { color: K.lavande, width: 1.5 } });
  bande(s, K, 6.55, 4.5, 5.9, 0.98, K.indigo, 'services');
  txt(s, 'identité · domaines · courrier · coffre · stockage · IA · sauvegardes · supervision',
    { x: 6.75, y: 4.5, w: 5.5, h: 0.98, fontSize: 14, color: K.blanc, valign: 'middle' });
  pastille(s, K, '= LA PLATEFORME QUI LES HÉBERGE', 6.3, 5.85, 6.4);
  s.addNotes("Le schéma central. À gauche, ce qu'est une application : le Socle, les packs dont elle a besoin, et votre code métier. "
    + "Elle sort de l'usine sous la forme d'une image signée, déposée au registre. À droite, ce qui la fait vivre : votre Hub l'installe "
    + "(base, secrets, domaine, certificat, route) et lui rend tous les services communs. Une application ne recode donc ni l'identité, "
    + "ni le courrier, ni les sauvegardes : elle les demande au Hub.");
  return s;
}

// ---------------------------------------------------------------- B3. La ville
async function diapoVille(pres, K, section) {
  const s = titreDiapo(pres, section, 'Une image pour tout retenir : la ville',
    'Chaque couche a son équivalent, et son rôle ne change pas d\'un projet à l\'autre.');
  const lignes = [
    ['FiLayers', K.nuit, 'Le Socle', 'les normes de construction : fondations, réseaux, sécurité'],
    ['FiPackage', K.violet, 'Les packs', 'les éléments préfabriqués : cuisine, ascenseur, domotique'],
    ['FiHome', K.vert, 'Une application', 'le bâtiment, construit pour un usage précis'],
    ['FiMap', K.indigo, 'Le Hub', 'la ville : adresses, courrier, badges, coffre, pompiers'],
    ['FiRadio', K.lavande, 'Minihub et mmh', 'les antennes de la ville jusque chez vous, sans ouvrir votre porte'],
  ];
  for (const [i, [ic, f, t, d]] of lignes.entries()) {
    const y = 1.95 + i * 0.95;
    await tuile(s, K, ic, 0.6, y, 0.55, f);
    txt(s, [{ text: t, options: { bold: true, fontSize: 15, color: K.encre, breakLine: true } }, { text: d, options: { fontSize: 13, color: K.gris } }],
      { x: 1.3, y: y - 0.05, w: 4.6, h: 0.85, valign: 'top' });
  }
  // La ville dessinée
  bande(s, K, 6.2, 1.9, 6.5, 4.75, K.nuit, 'ville');
  txt(s, 'La ville = le Hub', { x: 6.45, y: 2.02, w: 4, h: 0.4, fontSize: 15, bold: true, color: K.blanc });
  [[6.7, 1.5, 'App'], [7.85, 2.2, 'App'], [9.0, 1.15, 'App'], [10.15, 1.8, 'App']].forEach(([x, h, l], i) => {
    const y = 4.6 - h;
    s.addShape('rect', { x, y, w: 0.95, h, fill: { color: i % 2 ? 'C7D2FE' : 'FFFFFF' }, line: { type: 'none' }, objectName: 'bâtiment' });
    for (let r = 0; r < Math.floor(h / 0.38); r++) s.addShape('rect', { x: x + 0.2, y: y + 0.15 + r * 0.38, w: 0.55, h: 0.16, fill: { color: 'A5B4FC' }, line: { type: 'none' } });
    txt(s, l, { x, y: 4.62, w: 0.95, h: 0.28, fontSize: 11, color: K.lavande, align: 'center' });
  });
  s.addShape('rect', { x: 6.45, y: 4.95, w: 6.0, h: 0.12, fill: { color: 'A5B4FC' }, line: { type: 'none' }, objectName: 'réseaux' });
  txt(s, 'les réseaux de la ville', { x: 6.45, y: 5.1, w: 6.0, h: 0.3, fontSize: 11, italic: true, color: K.lavande, align: 'center' });
  [['adresses', 'DNS'], ['courrier', 'James'], ['badges', 'identité'], ['coffre', 'Vault'], ['pompiers', 'sauvegardes']].forEach(([a, b], i) => {
    const x = 6.45 + i * 1.22;
    pastille(s, K, a, x, 5.55, 1.12, K.indigo, K.blanc);
    txt(s, b, { x, y: 5.92, w: 1.12, h: 0.3, fontSize: 10, color: K.lavande, align: 'center' });
  });
  await tuile(s, K, 'FiRadio', 11.75, 2.05, 0.5, K.violet);
  s.addNotes("L'analogie, pour un public qui n'est pas technique. On n'invente pas les normes à chaque bâtiment (le Socle), on pose des éléments "
    + "préfabriqués (les packs), on construit le bâtiment pour son usage (l'application), et la ville fournit les réseaux : adresses (DNS), "
    + "courrier (James), badges (identité), coffre (Vault), pompiers (sauvegardes). Les antennes, minihub et mmh, prolongent la ville jusque chez vous "
    + "par un tunnel sortant : vous n'ouvrez pas votre porte.");
  return s;
}

// ---------------------------------------------------------------- B4. Qui fait quoi
async function diapoQuiFaitQuoi(pres, K, section) {
  const s = titreDiapo(pres, section, 'Chaque besoin a une seule adresse',
    'On ne recode pas ce que le Hub rend : le temps du projet ne va qu\'à la dernière ligne.');
  const C = couleurs(K);
  const lignes = [
    ['Se connecter, gérer des droits', 'HUB', 'identité, connexion unique'],
    ['Un domaine, un certificat', 'HUB', 'DNS, Let\'s Encrypt, proxy'],
    ['Envoyer du courrier', 'HUB', 'serveur de courrier'],
    ['Garder ses mots de passe', 'HUB', 'coffre à secrets'],
    ['Appeler un modèle d\'IA', 'HUB', 'passerelle IA, et le pack IA pour les prompts'],
    ['Notifier par SMS, Slack, Telegram', 'PACK', 'communication'],
    ['Enchaîner des étapes, avec reprise', 'PACK', 'pipeline'],
    ['Être supervisée, pilotable par l\'IA', 'SOCLE', 'workers, actions MCP, tableau de bord'],
    ['Vos règles, vos écrans, vos données', 'VOUS', 'le seul endroit où va le temps du projet'],
  ];
  txt(s, 'Une application a besoin de…', { x: 0.85, y: 1.78, w: 5, h: 0.35, fontSize: 12, bold: true, color: K.gris });
  txt(s, 'Qui le fournit', { x: 6.9, y: 1.78, w: 5, h: 0.35, fontSize: 12, bold: true, color: K.gris });
  lignes.forEach(([b, qui, d], i) => {
    const y = 2.18 + i * 0.5, dernier = i === lignes.length - 1;
    s.addShape('roundRect', { x: 0.6, y, w: 12.1, h: 0.44, rectRadius: 0.08, fill: { color: dernier ? 'D1FAE5' : 'FFFFFF' }, line: { color: BORD, width: 0.75 } });
    txt(s, b, { x: 0.85, y, w: 5.9, h: 0.44, fontSize: 14, bold: dernier, color: K.encre, valign: 'middle' });
    pastille(s, K, qui, 6.9, y + 0.06, 1.1, C[qui], K.blanc);
    txt(s, d, { x: 8.2, y, w: 4.4, h: 0.44, fontSize: 13, color: dernier ? K.vert : K.gris, bold: dernier, valign: 'middle' });
  });
  s.addNotes("La règle de routage de tout projet (CLAUDE.md du dépôt, et maillon M6 de la méthode Besoin→Plan) : d'abord le Hub, puis un pack, "
    + "puis un mécanisme du Socle. Les couleurs reprennent celles des couches. Une application qui recoderait l'identité ou l'envoi de courrier "
    + "serait refusée au contrôle avant go (famille 5, « ce qui ne doit pas être réécrit »).");
  return s;
}

// ---------------------------------------------------------------- B5. Plusieurs Hubs, un seul registre
async function diapoFlotte(pres, K, section) {
  const s = titreDiapo(pres, section, 'Plusieurs Hubs, un seul registre',
    'La même version, éprouvée en recette, part telle quelle chez chacun ; la flotte va jusqu\'à vos machines.');
  bande(s, K, 0.6, 1.9, 7.7, 0.85, K.nuit, 'registre');
  await tuile(s, K, 'FiAward', 0.8, 2.02, 0.6, K.indigo);
  txt(s, [{ text: 'Le registre', options: { bold: true, fontSize: 16, color: K.blanc, breakLine: true } }, { text: 'les images signées : le Hub, chaque application, chaque version', options: { fontSize: 13, color: K.lavande } }],
    { x: 1.6, y: 1.9, w: 6.6, h: 0.85, valign: 'middle' });
  const hubs = [['Hub de recette', 'on éprouve'], ['Hub de production', 'on promeut'], ['Hub d\'un client', 'chez lui']];
  for (const [i, [n, d]] of hubs.entries()) {
    const x = 0.6 + i * 2.66;
    fleche(s, K, x + 1.19, 2.8, 0, 0.42, K.indigo);
    bande(s, K, x, 3.3, 2.38, 1.15, K.indigo, n);
    txt(s, [{ text: n, options: { bold: true, fontSize: 14, color: K.blanc, breakLine: true } }, { text: d + ' · applications', options: { fontSize: 12, color: K.pale } }],
      { x: x + 0.2, y: 3.3, w: 2.0, h: 1.15, valign: 'middle' });
  }
  [[0.6, 'minihub', 'votre Mac'], [5.92, 'minihub', 'un serveur']].forEach(([x, n, d]) => {
    s.addShape('line', { x: x + 1.19, y: 4.5, w: 0, h: 0.55, line: { color: K.violet, width: 1.75, dashType: 'dash' } });
    txt(s, 'tunnel sortant 443', { x: x + 1.3, y: 4.6, w: 1.6, h: 0.3, fontSize: 10, italic: true, color: K.violet });
    carte(s, K, x, 5.1, 2.38, 0.85, n);
    txt(s, [{ text: n, options: { bold: true, color: K.encre, breakLine: true } }, { text: d, options: { color: K.gris } }], { x: x + 0.2, y: 5.1, w: 1.3, h: 0.85, fontSize: 13, valign: 'middle' });
    pastille(s, K, 'mmh', x + 1.55, 5.2, 0.7, K.violet, K.blanc);
    pastille(s, K, 'mmh', x + 1.55, 5.56, 0.7, K.violet, K.blanc);
  });
  carte(s, K, 8.7, 1.9, 4.0, 4.75, 'définitions');
  await point2(s, K, 'FiMonitor', 8.95, 2.15, 3.6, 'Le minihub', 'Un agent sur une de vos machines. Il ouvre lui-même un tunnel chiffré sortant vers le Hub.');
  await point2(s, K, 'FiRadio', 8.95, 3.45, 3.6, 'Le mmh', "Une antenne de 12 à 17 Mo : sortie réseau, envoi de courrier, tâches d'agent IA.");
  txt(s, '6', { x: 8.95, y: 4.8, w: 3.5, h: 0.75, fontSize: 40, bold: true, color: K.indigo, valign: 'bottom' });
  txt(s, 'Hubs en service, chez nous et chez nos clients', { x: 8.95, y: 5.58, w: 3.5, h: 0.6, fontSize: 13, color: K.gris, valign: 'top' });
  s.addNotes("Tous les Hubs tirent du même registre (repository.thesocle.net, images signées Ed25519). Promouvoir en production, c'est poser "
    + "sur le Hub de production exactement l'image éprouvée en recette, sans la reconstruire. Hubs en service au 2026-11-02 : thesocle.net, "
    + "thesocle.io, SOBOIA, bipforge, Machinapolis, lmvi-conseil. Le minihub (agent Java) et le mmh (agent Go de 12 à 17 Mo) se raccordent "
    + "par un tunnel gRPC mTLS sortant : aucun port à ouvrir chez le client.");
  return s;
}
async function point2(s, K, ic, x, y, w, t, d) {
  await tuile(s, K, ic, x, y, 0.5, K.indigo);
  txt(s, [{ text: t, options: { bold: true, fontSize: 15, color: K.encre, breakLine: true } }, { text: d, options: { fontSize: 13, color: K.gris } }],
    { x: x + 0.68, y: y - 0.04, w: w - 0.68, h: 1.15, valign: 'top' });
}

// ---------------------------------------------------------------- D1. La chaîne et ses six arrêts
const MAILLONS = ['Vision', 'Besoins et règles', 'User stories', 'Features et épics', 'Arbitrages', 'Phasage', 'Plan technique', 'Exécution'];
const ARRETS = { 0: ['①', 'Vision et rôles confirmés'], 1: ['②', 'Besoins signés : règles et droits, zéro « ? »'],
  4: ['③', 'Chaque décision tranchée, une par une'], 5: ['④', 'Les phases et leurs démos'],
  6: ['⑤', 'Le plan et sa matrice de couverture'], 7: ['⑥', 'Le « go » : le code commence ici'] };
function chaine(s, K, y, compacte) {
  const pas = 12.1 / 8;
  s.addShape('line', { x: 0.6 + pas / 2, y: y + 0.3, w: pas * 7, h: 0, line: { color: K.lavande, width: 2 } });
  MAILLONS.forEach((m, i) => {
    const cx = 0.6 + i * pas + pas / 2;
    rond(s, K, 'M' + i, cx - 0.3, y, 0.6, i === 7 ? K.vert : K.indigo, 13);
    txt(s, m, { x: cx - pas / 2 + 0.03, y: y + 0.68, w: pas - 0.06, h: 0.5, fontSize: compacte ? 11 : 12, bold: true, color: K.encre, align: 'center', valign: 'top' });
  });
  return pas;
}
async function diapoArrets(pres, K, section) {
  const s = titreDiapo(pres, section, 'Huit maillons, six arrêts : vous décidez',
    'La méthode Besoin→Plan s\'arrête et attend votre décision. Avant le sixième arrêt, pas une ligne de code.');
  const pas = chaine(s, K, 1.95, false);
  for (const [i, [n, d]] of Object.entries(ARRETS)) {
    const x = 0.6 + Number(i) * pas + 0.05, w = pas - 0.1;
    s.addShape('line', { x: x + w / 2, y: 3.15, w: 0, h: 0.3, line: { color: K.violet, width: 1.5 } });
    s.addShape('roundRect', { x, y: 3.45, w, h: 1.9, rectRadius: 0.1, fill: { color: Number(i) === 7 ? 'D1FAE5' : 'FFFFFF' }, line: { color: Number(i) === 7 ? '059669' : BORD, width: 0.75 } });
    txt(s, n, { x, y: 3.55, w, h: 0.5, fontSize: 24, bold: true, color: Number(i) === 7 ? K.vert : K.violet, align: 'center' });
    txt(s, d, { x: x + 0.1, y: 4.1, w: w - 0.2, h: 1.2, fontSize: 12, color: K.encre, align: 'center', valign: 'top' });
  }
  bande(s, K, 0.6, 5.6, 12.1, 1.05, K.nuit, 'règle');
  txt(s, [{ text: 'La règle  ', options: { bold: true, color: K.lavande } },
    { text: 'à chaque arrêt, un résumé court et une seule décision attendue. Tant qu\'une décision bloquante est ouverte, rien ne se code.', options: { color: K.blanc } }],
  { x: 0.9, y: 5.6, w: 11.5, h: 1.05, fontSize: 15, valign: 'middle' });
  s.addNotes("La méthode Besoin→Plan (kit 1.16.0) : M0 vision, M1 spécification des besoins avec les règles de gestion et la matrice d'habilitations, "
    + "M2 user stories testables, M3 features et épics, M4 arbitrages tranchés avant le plan, M5 phasage dont chaque phase se termine par une démo, "
    + "M6 plan technique et matrice de couverture, M7 exécution. Les six arrêts sont ceux du prompt pilote : vision, besoins signés, arbitrages un par un, "
    + "phasage, plan, puis le go du code, qui n'est présenté qu'après le contrôle avant go. Les doutes sont visibles, marqués [À ARBITRER], puis tranchés.");
  return s;
}

// ---------------------------------------------------------------- D2. La matrice de couverture
async function diapoMatrice(pres, K, section) {
  const s = titreDiapo(pres, section, 'Chaque promesse est tracée jusqu\'à sa preuve',
    'Trois axes qu\'on ne mélange jamais, et un seul endroit où ils se croisent : la matrice de couverture.');
  const axes = [['FiFlag', K.vert, 'MÉTIER', 'ce qu\'on promet', 'Épic ▸ Feature ▸ US-12'],
    ['FiTool', K.violet, 'TECHNIQUE', 'avec quoi on le fait', 'la brique : un service du Hub'],
    ['FiPlayCircle', K.indigo, 'LIVRAISON', 'quand on le montre', 'phase P2, sa démo, son test vert']];
  for (const [i, [ic, f, t, sous, ex]] of axes.entries()) {
    const x = 0.6 + i * 4.15;
    carte(s, K, x, 1.85, 3.8, 1.75, t);
    await tuile(s, K, ic, x + 0.22, 2.05, 0.5, f);
    txt(s, [{ text: t, options: { bold: true, fontSize: 15, color: K.encre, breakLine: true } }, { text: sous, options: { fontSize: 13, color: K.gris } }],
      { x: x + 0.9, y: 2.0, w: 2.8, h: 0.7, valign: 'top' });
    txt(s, ex, { x: x + 0.22, y: 2.85, w: 3.4, h: 0.55, fontSize: 13, italic: true, color: f, valign: 'middle' });
    if (i < 2) fleche(s, K, x + 3.85, 2.72, 0.27, 0, K.lavande);
  }
  // La matrice
  const cols = [['US', 1.1], ['épic', 1.0], ['phase', 1.0], ['brique', 2.6], ['test', 1.0]];
  const rows = [['US', 'épic', 'phase', 'brique', 'test'], ['US-12', 'E2', 'P2', 'service du Hub : identité', '✔'],
    ['US-13', 'E2', 'P3', 'pack IA', '✔'], ['US-14', 'E3', 'P3', 'code métier', '✔']];
  rows.forEach((r, j) => {
    let x = 0.6;
    r.forEach((c, k) => {
      const w = cols[k][1];
      s.addShape('rect', { x, y: 4.05 + j * 0.6, w, h: 0.6, fill: { color: j === 0 ? '4F46E5' : 'FFFFFF' }, line: { color: BORD, width: 0.75 } });
      txt(s, c, { x: x + 0.1, y: 4.05 + j * 0.6, w: w - 0.2, h: 0.6, fontSize: 13, bold: j === 0, color: j === 0 ? K.blanc : (k === 4 ? K.vert : K.encre), valign: 'middle' });
      x += w;
    });
  });
  txt(s, 'exemple', { x: 0.6, y: 6.5, w: 3, h: 0.25, fontSize: 10, italic: true, color: K.gris });
  await point2(s, K, 'FiArrowDown', 7.7, 4.15, 5.0, 'Lue de haut en bas', 'rien n\'est oublié : chaque promesse a sa brique, son test, sa démo.');
  await point2(s, K, 'FiArrowRight', 7.7, 5.35, 5.0, 'Lue de gauche à droite', 'rien n\'est codé en trop : chaque brique sert une promesse.');
  s.addNotes("Principe fondateur de la méthode : trois axes orthogonaux. Métier (les user stories, groupées en features puis en épics), technique "
    + "(les briques), livraison (les phases et leurs gates). Un artefact ne porte qu'un axe : la fiche d'une user story est purement métier. "
    + "Le seul lieu où les trois se croisent est la matrice de couverture (maillon M6), avec une colonne de tests remplie avant le go. "
    + "« Une épic = un worker » est faux : une épic traverse plusieurs briques, et une brique sert plusieurs épics.");
  return s;
}

// ---------------------------------------------------------------- D3. Le routage
const ROUTAGE = [
  ['Le Hub le rend-il déjà ?', 'HUB', 'on le consomme', '44 guides de service'],
  ['Un pack le rend-il dans l\'application ?', 'PACK', 'on l\'embarque', '8 packs'],
  ['Par quel mécanisme du Socle l\'écrire ?', 'SOCLE', 'on l\'écrit selon sa fiche', '148 cas d\'usage'],
  ['Aucun ne le couvre ?', 'VOUS', '« NON COUVERT » : dit avant de coder', 'puis le catalogue s\'enrichit'],
];
async function diapoRoutage(pres, K, section) {
  const s = titreDiapo(pres, section, 'Avant chaque brique, trois questions, dans cet ordre',
    'C\'est la méthode qui fait respecter les couches : on ne recode jamais ce qui existe déjà.');
  const C = couleurs(K);
  ROUTAGE.forEach(([q, qui, r, src], i) => {
    const y = 1.9 + i * 1.18;
    carte(s, K, 0.6, y, 6.1, 0.95, q);
    rond(s, K, String(i + 1), 0.82, y + 0.17, 0.6, i === 3 ? K.gris : K.indigo, 16);
    txt(s, q, { x: 1.62, y, w: 5.0, h: 0.95, fontSize: 16, bold: true, color: K.encre, valign: 'middle' });
    fleche(s, K, 6.8, y + 0.47, 0.55, 0, C[qui]);
    txt(s, i < 2 ? 'oui' : '', { x: 6.8, y: y + 0.08, w: 0.55, h: 0.3, fontSize: 11, italic: true, color: K.gris, align: 'center' });
    bande(s, K, 7.45, y, 5.25, 0.95, C[qui], r);
    txt(s, [{ text: r, options: { bold: true, fontSize: 15, color: K.blanc, breakLine: true } }, { text: src, options: { fontSize: 12, color: K.blanc } }],
      { x: 7.7, y, w: 4.85, h: 0.95, valign: 'middle' });
    if (i < 3) txt(s, 'non ↓', { x: 0.75, y: y + 0.96, w: 0.9, h: 0.22, fontSize: 10, italic: true, color: K.gris, align: 'center' });
  });
  s.addNotes("Maillon M6 de la méthode, depuis le kit 1.11 : chaque brique du plan cite, dans cet ordre, son guide de service du Hub "
    + "(CATALOGUE-SERVICES, 44 guides), le pack qui la rend (CATALOGUE-PACKS, 8 packs), puis sa fiche de mécanisme du Socle "
    + "(CATALOGUE-MECANISMES, 148 fiches). Ce qu'aucun ne couvre est écrit « NON COUVERT » avant d'être codé. L'ordre compte : "
    + "interrogé à l'envers, on réécrit un service que la plateforme rend déjà. Les couleurs sont celles des couches.");
  return s;
}

// ---------------------------------------------------------------- D4. La preuve externe
async function diapoPreuve(pres, K, section) {
  const s = titreDiapo(pres, section, 'Rien ne se prouve par lui-même',
    'Chaque affirmation du projet a une preuve qui lui est extérieure.');
  const lignes = [['FiList', 'Une exigence', 'son test'], ['FiSlash', 'Une règle métier', 'son contre-exemple, qui doit être rejeté'],
    ['FiPlayCircle', 'Une phase', 'sa démo, en vrai, jamais une liste cochée'], ['FiMonitor', 'Un écran', 'sa traversée dans un vrai navigateur, dans le rôle'],
    ['FiArchive', 'Une sauvegarde', 'sa restauration'], ['FiUsers', 'Une spécification', 'un relecteur qui ne l\'a pas écrite']];
  txt(s, 'Ce qu\'on affirme', { x: 0.6, y: 1.78, w: 3, h: 0.3, fontSize: 12, bold: true, color: K.gris });
  txt(s, 'Ce qui le prouve', { x: 4.6, y: 1.78, w: 3, h: 0.3, fontSize: 12, bold: true, color: K.gris });
  for (const [i, [ic, a, p]] of lignes.entries()) {
    const y = 2.15 + i * 0.75;
    carte(s, K, 0.6, y, 3.5, 0.62, a);
    await tuile(s, K, ic, 0.72, y + 0.09, 0.44, K.violet);
    txt(s, a, { x: 1.3, y, w: 2.7, h: 0.62, fontSize: 14, bold: true, color: K.encre, valign: 'middle' });
    fleche(s, K, 4.15, y + 0.31, 0.38, 0, K.indigo);
    s.addShape('roundRect', { x: 4.6, y, w: 3.75, h: 0.62, rectRadius: 0.1, fill: { color: 'E0E7FF' }, line: { type: 'none' } });
    txt(s, p, { x: 4.75, y, w: 3.5, h: 0.62, fontSize: 13, color: K.nuit, valign: 'middle' });
  }
  bande(s, K, 8.75, 2.15, 3.95, 4.37, K.nuit, 'maxime');
  await tuile(s, K, 'FiEye', 9.05, 2.45, 0.6, K.indigo);
  txt(s, 'Ce qui n\'a pas de preuve externe est une opinion bien présentée.', { x: 9.05, y: 3.25, w: 3.4, h: 1.6, fontSize: 20, bold: true, color: K.blanc, valign: 'top' });
  txt(s, 'Zéro maquette, zéro simulation, zéro faux vert : sans dépendance réelle, l\'application dit honnêtement « en attente ».',
    { x: 9.05, y: 4.95, w: 3.4, h: 1.4, fontSize: 13, color: K.lavande, valign: 'top' });
  s.addNotes("Le principe unificateur de la méthode (ESSENTIEL.md §1 et §5). L'écran a été ajouté en 1.10 après cinq défauts d'interface "
    + "invisibles à 202 tests verts : une capture pleine page ne prouve pas qu'on peut traverser un écran, il faut le parcourir dans le rôle. "
    + "La méthode elle-même est prouvée par ses chantiers réels : 26 chantiers dans le dépôt au 2026-11-03.");
  return s;
}

// ---------------------------------------------------------------- D5. Le contrôle avant go
async function diapoControle(pres, K, section) {
  const s = titreDiapo(pres, section, 'Avant le « go », le plan passe un contrôle en neuf familles',
    'Il vérifie que le projet respecte la plateforme. Une partie des points est vérifiée par un script.');
  const fam = [['FiDatabase', 'Données', 'le standard de table, un schéma par application'],
    ['FiKey', 'Identité', 'tout passe par l\'IAM du Hub, aucune table d\'utilisateurs'],
    ['FiShare2', 'Exposition', 'tout ce qui sort passe par l\'APIM ou le proxy'],
    ['FiLock', 'Secrets', 'dans le coffre, jamais dans le code'],
    ['FiCopy', 'Non-réécriture', 'ce que le Hub rend n\'est pas recodé'],
    ['FiCpu', 'Architecture', 'des workers et des actions selon le Socle'],
    ['FiActivity', 'Exploitation', 'sauvegarde, supervision, retour arrière'],
    ['FiGitBranch', 'Traçabilité', 'chaque besoin relié à son code'],
    ['FiCheckCircle', 'Qualité', 'zéro maquette, zéro simulation, zéro faux vert']];
  for (const [i, [ic, t, d]] of fam.entries()) {
    const x = 0.6 + (i % 3) * 4.07, y = 1.85 + Math.floor(i / 3) * 1.62;
    carte(s, K, x, y, 3.9, 1.45, t);
    await tuile(s, K, ic, x + 0.22, y + 0.25, 0.5, i % 2 ? K.indigo : K.violet);
    txt(s, [{ text: (i + 1) + '  ' + t, options: { bold: true, fontSize: 15, color: K.encre, breakLine: true } }, { text: d, options: { fontSize: 13, color: K.gris } }],
      { x: x + 0.9, y: y + 0.2, w: 2.85, h: 1.1, valign: 'top' });
  }
  s.addNotes("TEMPLATE-CONTROLE-AVANT-GO du kit : neuf familles, une partie des points marqués 🤖 vérifiés par controle-avant-go.sh "
    + "(nomenclature des tables, triggers, absence de table d'utilisateurs, références aux catalogues…). L'arrêt ⑥ ne se présente jamais nu : "
    + "le contrôle est déroulé d'abord, ses écarts relevés, puis le go est demandé.");
  return s;
}

// ---------------------------------------------------------------- Version courte : la méthode en une diapositive
async function diapoMethodeCourte(pres, K, section) {
  const s = titreDiapo(pres, section, 'La méthode : vous décidez, puis on construit',
    'Six arrêts de décision avant le code, et trois questions avant chaque brique.');
  const pas = chaine(s, K, 1.9, true);
  Object.entries(ARRETS).forEach(([i, [n]]) => txt(s, n, { x: 0.6 + Number(i) * pas, y: 3.05, w: pas, h: 0.45, fontSize: 20, bold: true, color: Number(i) === 7 ? K.vert : K.violet, align: 'center' }));
  const C = couleurs(K);
  ROUTAGE.slice(0, 3).forEach(([q, qui, r, src], i) => {
    const x = 0.6 + i * 4.07;
    carte(s, K, x, 3.75, 3.9, 1.35, q);
    rond(s, K, String(i + 1), x + 0.2, 3.95, 0.5, K.indigo, 14);
    txt(s, q, { x: x + 0.85, y: 3.85, w: 2.9, h: 1.15, fontSize: 14, bold: true, color: K.encre, valign: 'middle' });
    bande(s, K, x, 5.25, 3.9, 0.75, C[qui], r);
    txt(s, [{ text: r, options: { bold: true, breakLine: true } }, { text: src, options: { fontSize: 11 } }], { x: x + 0.2, y: 5.25, w: 3.5, h: 0.75, fontSize: 14, color: K.blanc, valign: 'middle' });
  });
  txt(s, 'Ce qu\'aucun ne couvre est déclaré « NON COUVERT » avant d\'être codé.', { x: 0.6, y: 6.15, w: 12.1, h: 0.4, fontSize: 14, italic: true, color: K.gris });
  return s;
}

module.exports = { diapoMemeSocle, diapoFabriquer, diapoVille, diapoQuiFaitQuoi, diapoFlotte,
  diapoArrets, diapoMatrice, diapoRoutage, diapoPreuve, diapoControle, diapoMethodeCourte };
