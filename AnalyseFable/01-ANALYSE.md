# Analyse critique de la méthode LMVI Besoin2Plan — Fable

> **Date** : 2026-07-06 · **Analyste** : Claude Fable 5 · **Périmètre** : `docs/methode-lmvi/` complet
> (README, CONTRAT-ARCHITECTURE, METHODE-Besoin2Plan, 10 templates, `gen-fiches-us.py`, prompt,
> 9 slots du corpus d'inputs).
>
> Documents associés : [02-PLAN-CHANGEMENT.md](02-PLAN-CHANGEMENT.md) ·
> [03-MATRICE-VERIFICATION.md](03-MATRICE-VERIFICATION.md)

---

## Verdict global

La méthode est bonne dans son cœur conceptuel — les 3 axes orthogonaux, M4 comme maillon à part
entière, la matrice de couverture et « gate = démo » sont de vraies trouvailles, supérieures à
beaucoup de méthodes agiles génériques. Mais elle souffre de **trois faiblesses structurelles** :

1. elle n'a été validée que sur un seul chantier (Régie) **et ça fuit partout** ;
2. elle est **purement linéaire** — aucune boucle de retour définie ;
3. sa promesse d'orthogonalité est **contredite par ses propres artefacts** (la fiche US porte
   des décisions M5/M6).

Rien ne remet en cause l'ossature : ce sont les défauts typiques d'une v1 distillée d'un chantier
unique. La 2ᵉ instance est le vrai test.

---

## 1. Ce qui va bien (à préserver absolument)

| # | Point fort | Pourquoi c'est précieux |
|---|---|---|
| F-1 | **Les 3 axes métier/technique/livraison** + rejet explicite du mapping « 1 épic = 1 worker » | Peu de méthodes formalisent cette orthogonalité ; c'est le principe le plus précieux du kit |
| F-2 | **M4 Arbitrages comme maillon bloquant** | Exactement le maillon que les méthodes classiques oublient — « on ne passe pas au plan tant qu'une décision structurante est ouverte » |
| F-3 | **La matrice de couverture US→épic→phase→brique** | Garde-fou concret à double lecture : verticale = couverture, horizontale = chemin besoin→démo |
| F-4 | **Gate = démo, pas coche de tâche** + clause zéro-mock | Cohérent avec la culture « preuve réelle » LMVI |
| F-5 | **M7 Câblage** (où va le code, quels inputs, quelle cible) | La plupart des méthodes s'arrêtent au plan ; vrai différenciateur |
| F-6 | **Séparation méthode générique / contrat d'architecture / instance** | Bonne architecture documentaire : une app hérite, ne redécide pas |
| F-7 | **Templates courts** (26–51 lignes chacun) | Le kit reste léger, il ne bureaucratise pas |

---

## 2. Ce qui ne va pas

### D-1 · L'orthogonalité proclamée est violée par la fiche US *(le problème le plus profond)*

Le principe fondateur (§0 de la méthode) dit qu'on ne mélange jamais les 3 axes. Or
`TEMPLATE-US.md` — artefact du maillon **M2** — contient les champs **Phase (M5)** et
**Brique (M6)**, et le générateur `gen-fiches-us.py` exige `ph=` et `br=` pour chaque US *au
moment de la saisie des données*. Concrètement, on ne peut pas produire les fiches M2 sans avoir
déjà tranché M5 et M6.

Conséquences :
- **Chicken-and-egg** : dans la pratique réelle (visible dans le script), M2 est rédigé *après*
  M6, ce qui contredit la chaîne affichée M2→M3→…→M6.
- **Couplage de maintenance** : si le phasage bouge (il bougera), il faut régénérer toutes les
  fiches US. La fiche US porte des décisions aval qu'elle ne devrait que *référencer*.

**Piste** : la fiche US ne porte que l'axe métier (histoire, CA, RG, dépendances) ; le
rattachement phase/brique vit **uniquement dans la matrice de couverture (M6)** — l'artefact
justement conçu pour relier les 3 axes. Alternative : assumer le remplissage en deux passes et le
documenter explicitement.

### D-2 · Aucune boucle de retour : un waterfall léger qui ne dit pas comment encaisser le réel

La chaîne est strictement descendante. Rien ne définit :
- ce qui se passe quand **une gate échoue** (on redémontre ? on descope ? on retourne à quel maillon ?) ;
- comment un apprentissage en M7 (ex. « le parseur ne tient pas la granularité promise »)
  **remonte** vers la spec, les US et la matrice — qui met à jour quoi ; la matrice reste-t-elle
  source de vérité après PA-1 ? ;
- comment on **splitte / ajoute / abandonne une US** en cours de phase (renumérotation ?
  US orpheline dans la matrice ?).

Le « double-track » de M7 mentionne le raffinement du kit méthode, mais pas le raffinement *des
livrables amont du chantier lui-même*. C'est le trou qui fera pourrir la matrice de couverture —
le meilleur artefact du kit — dès la deuxième phase.

**Piste** : un maillon « M8 · Rétro-propagation » ou une règle par maillon « conditions de
réouverture » + cycle de vie d'une US (à faire / en cours / livrée / splittée / abandonnée).

### D-3 · Le générique fuit du Régie partout

- `TEMPLATE-US.md` (censé générique) contient un lien en dur vers `SPEC-ATELIER-DECOMPOSITION.md`.
- `gen-fiches-us.py` a `ROOT` en dur sur `APP-16-REGIES` et **les données US inline dans le code
  Python** (~300 lignes de dicts). Pour la 2ᵉ instance, il faudrait éditer le code : les données
  devraient être un fichier YAML/JSON externe, le script devenant réellement générique.
- La méthode est distillée d'un seul chantier (**N=1**) : des règles comme « P-0 = socle » ou
  « ré-estimer × 2 » sont des observations Régie promues en lois. Assumable en v1, mais le kit
  devrait les marquer « règle candidate, à confirmer sur instance 2 ».

### D-4 · Incohérences internes (décrédibilisent un kit dont l'argument est la rigueur)

| Où | Incohérence |
|---|---|
| `METHODE-Besoin2Plan.md` §1 | « La chaîne en **6 maillons** » — il y en a **8** (M0→M7) |
| `methode/README.md` | Annonce « la méthodologie de référence (**M0→M6**…) » alors que tout le reste dit M0→M7 |
| M5 vs US/tags/exemple | Nommage des phases : `P-0…P-n` (METHODE, TEMPLATE-M5) vs `PA-x` (TEMPLATE-US, tags, exemple Régie) |
| `CLAUDE.md` racine vs slot 1 | CLAUDE.md pointe `docs/01-docsV2/` qui **n'existe plus** ; le slot 1 pointe `docs/docs-socleV005/01-docsV2/` qui existe (c'est CLAUDE.md qui est en retard — illustre D-5) |

### D-5 · Copies vendorées sans mécanisme de resync ni versionnage

Le kit dit : l'instance copie (méthode + slots) et « note la source canonique pour resync ». Mais
il n'y a **ni version sur les templates, ni procédure de resync, ni marqueur de divergence**.
Avec la copie vendorée de Régie déjà actée et le slot 5.8.0 « ⏳ à aligner », la dérive
canonique↔instances est garantie.

**Piste minimale** : un `KIT-VERSION` (semver — la convention existe déjà chez LMVI) dans chaque
template + un CHANGELOG du kit ; l'instance note la version copiée.

### D-6 · Angles morts fonctionnels

- **Exigences non fonctionnelles sans domicile** : perf, volumétrie, coût LLM par run, rétention…
  Le contrat d'architecture couvre le *plateforme*, mais le template M1 n'a aucune section NFR
  niveau *app*. Sur Régie, le coût LLM n'apparaît qu'en épic G (traçabilité) — après coup.
- **Stratégie de test quasi absente** : « US démontrable par un test d'acceptation » (M2) et
  « preuve à chaque gate » (M7), mais rien entre les deux : où vivent les tests, automatisés ou
  manuels, qui protège la clause « zéro régression » entre deux gates ? Une démo prouve la phase
  N, pas que la phase N−1 marche encore.
- **Estimation réduite à « × 2 »** : honnête pour du solo+agents IA, mais alors il faut l'écrire ;
  en l'état ça ressemble à un trou.
- **Rôles flous** : « le commanditaire », « un tiers comprend » — dans le contexte réel
  (1 humain + agents IA), qui joue le tiers relecteur ? La relecture est « possible » donc
  optionnelle, ce qui affaiblit les DoD.

### D-7 · Points mineurs

- Le script « nettoie les anciennes fiches US » tout en « patchant les liens des fichiers édités
  à la main » — la frontière entre ce qui est écrasé et ce qui est préservé est ambiguë ; à
  préciser avant qu'une édition manuelle soit perdue.
- Le critère de choix Besoin2Plan vs FromSpec2Plan tient en un paragraphe qualitatif. Une règle
  de décision en 3-4 questions le rendrait reproductible.
- DoD M3 « toute US dans exactement un épic » : dire quoi faire des US transverses (B6
  multi-tenant en est déjà une) — le tag `epic/x` du frontmatter permettrait un épic secondaire
  sans casser la règle.

---

## 3. Priorisation recommandée

1. **D-1** — Découpler la fiche US des décisions M5/M6 (ou documenter la double passe) : touche le principe fondateur.
2. **D-2** — Définir la boucle de retour : échec de gate, rétro-propagation, cycle de vie d'une US.
3. **D-3** — Dé-Régie-iser le kit : données YAML externes, lien Régie retiré du template, marquage « règle candidate ».
4. **D-4** — Corriger les incohérences : « 6 maillons »→8, M0→M6→M0→M7, unifier P-x/PA-x.
5. **D-5** — Versionner le kit et définir le resync des copies vendorées.
6. **D-6** — Section NFR au template M1 + stratégie de test en M6/M7.
7. **D-7** — Points mineurs (comportement du script, règle de choix des méthodes, US transverses).
