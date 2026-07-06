# Plan de transformation — préparer la méthode au premier cas pratique réel

> **Date** : 2026-07-06 · **Source** : [05-ANALYSE-GESTALT.md](05-ANALYSE-GESTALT.md) ·
> **Déclencheur** : un chantier réel arrive — il devient le **banc d'essai officiel** de la méthode.
>
> **Principe du plan** : on ne rajoute plus de templates spéculatifs (la critique G-2 l'interdit) ;
> on transforme le **système d'exploitation de la méthode** — preuve, légèreté, mesure — pour que
> le cas pratique puisse la juger. Trois lots : **A avant** le chantier (v1.7.0), **B pendant**,
> **C après** (v1.8.0, distillée du terrain).

---

## Lot A — AVANT le chantier (v1.7.0, à exécuter maintenant)

### T-1 · Nommer le principe unificateur — *répond à Gestalt §7*
- `conception/METHODE-Besoin2Plan.md` §0 : écrire **au-dessus des 3 axes** le principe
  **« Tout artefact doit être prouvé par quelque chose d'extérieur à lui »** + la table de
  déclinaison (US→test, RG→contre-exemple, phase→démo, backup→restauration, doc→rejouabilité,
  spec→relecteur qui ne l'a pas écrite, **kit→chantier réel**).
- Les 3 axes deviennent le 2ᵉ principe (« comment ranger ») ; la preuve externe est le 1ᵉʳ
  (« comment croire »).

**DoD** : METHODE §0 ouvre sur le principe ; chaque pilier README y renvoie en une ligne.

### T-2 · Profils d'activation — *répond à Gestalt §1 (légèreté perdue)*
Trois profils déclarés au **casting M0**, lus par le **PROMPT-PILOTE** :

| Profil | Contenu | Pour |
|---|---|---|
| **express** | M0 en 5 lignes · M1 = 1 page (concepts + RG + `[À ARBITRER]`) · M4 · matrice M6 minimale (US→brique→test→gate) · 1 seule phase | feature ≤ ~1 semaine, domaine connu |
| **solo** | `conception/` complet (chaîne + RG/habilitations/tests) | app interne, l'existant |
| **client** | les 3 piliers | chantier contractuel |

- Nouveau fichier : `conception/PROFILS.md` (le tableau + règles de passage d'un profil à l'autre
  en cours de route — un express qui grossit **monte** en solo, jamais l'inverse en silence).
- `USAGE.md` §0 : la question « quel profil ? » s'ajoute aux 3 questions de choix de méthode.
- `PROMPT-PILOTE.md` : le pilote demande le profil à M0 et n'exige que les artefacts du profil.

**DoD** : un chantier express produit ≤ 5 fichiers ; le pilote adapte ses 6 arrêts au profil
(express : ① vision ③ arbitrages ⑥ go — 3 arrêts).

### T-3 · Seuil d'entrée & critère d'arrêt — *répond à Gestalt §8*
- `conception/PROFILS.md` § « En-deçà du seuil » : quand on ne déroule **rien** (spike jetable,
  fix, incident — la règle : *si l'intention tient dans un message et se prouve par un test, pas
  de méthode*) ; l'issue d'un spike reste consignable en M4 du chantier parent.
- `METHODE` §2 (boucles) : ajout §2.4 **« Arrêter un chantier »** — kill criterion explicite :
  {{2 gates consécutives ajournées sur la même phase, ou budget consommé sans valeur démontrée,
  ou décision commanditaire}} → post-mortem obligatoire (T-5), artefacts archivés, jamais effacés.

**DoD** : les deux règles écrites ; le pilote connaît §2.4 (il peut *proposer* l'arrêt).

### T-4 · Relecteur hors-famille — *répond à Gestalt §6*
- `METHODE` §1 (relectures M1/M4/M6) : la relecture requise doit être **différente en nature** du
  producteur — au choix : humain métier, **ou autre modèle LLM** (la plateforme en a : minimax /
  glm47 via AgentIA-APIM, opencode). Une session différente du même modèle = relecture de
  confort, plus acceptée seule en contexte client.
- `PROMPT-PILOTE.md` règle 3 : le pilote **déclare** quel relecteur hors-famille il a utilisé.

**DoD** : la règle est écrite avec les options concrètes de la plateforme ; testée une fois avant
le chantier (une relecture réelle par un autre modèle, preuve jointe).

### T-5 · Dispositif de preuve terrain — *répond à Gestalt §2 et §5 (le cœur du plan)*
Le cas pratique juge la méthode. Pour que le jugement soit exploitable :
- **Gel du canonique** pendant le chantier : plus aucun tag tant que le chantier n'est pas fini
  (les frictions se notent, ne se corrigent pas à chaud — sauf blocage dur, décision commanditaire).
- Nouveau template : `conception/TEMPLATE-RETEX.md` — le **post-mortem méthode** d'un chantier :
  par maillon/artefact : *utilisé ? utile ? friction ? temps passé ?* ; par template : *instancié
  en réel → sort du statut ⚗️ / inutilisé → candidat à la coupe*. Une **v = un RETEX** devient la
  règle de cadence (écrite dans le CHANGELOG et le README).
- **Journal de frictions** : le pilote tient `KIT-FRICTIONS.md` dans l'instance (une ligne par
  friction rencontrée avec le kit, à chaud, sans corriger) — la matière première du RETEX.
- **Statut de preuve des templates** : chaque template gagne une ligne en tête
  `<!-- PROUVE-SUR: — -->` (renseignée par les RETEX successifs). Aujourd'hui, honnêtement :
  la plupart affichent « — ».

**DoD** : TEMPLATE-RETEX livré ; règle de cadence écrite ; `PROUVE-SUR` posé sur tous les
templates (avec « Régie (M0→M7 v1.0) » là où c'est vrai, « — » ailleurs) ; pilote tient le journal.

### T-6 · Instrumentation économique — *répond à Gestalt §8 (économie)*
- `PROMPT-PILOTE.md` règle 4 (PILOTAGE.md) : le pilote enregistre par maillon **date début/fin,
  nombre d'allers-retours commanditaire, décisions en attente et leur latence**. Le RETEX agrège :
  coût de la méthode vs taille du projet — en données, pas en impression.

**DoD** : PILOTAGE.md a un format de mesure ; le RETEX a sa section « économie ».

### T-7 · L'essentiel en une page — *répond à Gestalt §4 (hiérarchie intellectuelle)*
- Nouveau fichier : `ESSENTIEL.md` (racine, 1 page maximum) : le principe de preuve externe, les
  3 axes, gate = démo, les boucles — **zéro template, zéro procédure**. C'est la page qu'on donne
  à lire en premier à un client ou un nouvel intervenant ; README et USAGE pointent dessus.

**DoD** : 1 page ; un tiers comprend la philosophie sans ouvrir un seul template.

---

## Lot B — PENDANT le chantier (discipline, pas de livrable kit)

1. Chantier déroulé au **PROMPT-PILOTE**, profil déclaré à M0 (probablement `client` ou `solo`
   selon le cas — décision M0).
2. **Canonique gelé** ; toute friction → `KIT-FRICTIONS.md`, on n'édite pas le kit à chaud.
3. Relectures M1/M4/M6 **hors-famille** (T-4) — première mondiale pour le kit.
4. Les templates conformité/run activés se prouvent **en réel** (leur gate du kit, enfin) ;
   ceux non activés restent ⚗️ sans honte.
5. Mesures T-6 tenues dans PILOTAGE.md.

## Lot C — APRÈS le chantier (v1.8.0, la version distillée)

1. **RETEX** (TEMPLATE-RETEX) : rempli par le pilote, arbitré par le commanditaire.
2. `PROUVE-SUR` mis à jour partout ; templates inutilisés → **coupés ou fusionnés** (le kit doit
   pouvoir maigrir — première fois qu'on se l'autorise).
3. v1.8.0 taguée = uniquement ce que le RETEX justifie. Resync de l'instance Régie au passage.
4. **Arbitrage reporté sciemment ici** (avec des données) : la méthode est-elle un *produit*
   (mode sans agent à construire) ou un *avantage interne* (le client reçoit les artefacts) —
   Gestalt §3. Trancher avant serait spéculer.

---

## Matrice de vérification du lot A

| # | Changement | Critère objectif | Preuve | Statut |
|---|---|---|---|---|
| T-1 | Principe unificateur en §0 | METHODE ouvre sur la preuve externe + table de déclinaison | lecture + grep « prouvé par » | à faire |
| T-2 | Profils express/solo/client | `PROFILS.md` existe ; pilote adapte ses arrêts ; express ≤ 5 fichiers | déroulé express à blanc (2 US) | à faire |
| T-3 | Seuil d'entrée + §2.4 arrêt | les 2 règles écrites, pilote les connaît | lecture | à faire |
| T-4 | Relecteur hors-famille | règle écrite avec options plateforme + 1 relecture réelle par autre modèle | sortie de la relecture jointe | à faire |
| T-5 | RETEX + gel + PROUVE-SUR | template livré ; cadence écrite ; `grep -L "PROUVE-SUR" conception/TEMPLATE-*.md …` vide | grep + lecture | à faire |
| T-6 | Instrumentation PILOTAGE | format de mesure dans PROMPT-PILOTE | lecture | à faire |
| T-7 | ESSENTIEL.md 1 page | ≤ 1 page, zéro template mentionné | wc -l + relecture tiers | à faire |

**Gate du lot A** : un mini-chantier **express** déroulé à blanc de bout en bout (2 US) avec le
pilote v1.7 — profil respecté, mesures enregistrées, RETEX d'une ligne produit. Puis tag `v1.7.0`
et **gel jusqu'à la fin du cas pratique**.

---

## Points à trancher par le commanditaire avant d'exécuter

1. **Contenu du profil express** (T-2) : la coupe proposée (M0-5-lignes · M1-1-page · M4 ·
   matrice mini · 1 phase) te va-t-elle ?
2. **Relecteur hors-famille par défaut** (T-4) : minimax via APIM ? opencode ? un humain sur le
   cas pratique ?
3. Le **cas pratique** : profil pressenti (solo ou client ?) — ça décide quels piliers passeront
   leur épreuve du feu.
