<!-- KIT-VERSION: 1.8.1 -->
<!-- PROUVE-SUR: — -->
# Profils d'activation & modes d'entrée

> Déclarés au **casting M0**, lus par le **PROMPT-PILOTE**. Deux dimensions indépendantes.
> **Règle d'or : un profil ne contraint JAMAIS la taille des documents** — un chantier express peut
> avoir une spec courte, un chantier client un CdC de 36 pages ; le profil contraint **les
> artefacts requis et les points d'arrêt**, la taille s'adapte au sujet.

## Dimension 1 — le mode d'entrée

| Mode | Quand | Ce que ça change |
|---|---|---|
| **besoin exprimé** | le besoin est oral / en vrac / quelques pages de notes | M0/M1 s'**écrivent** (reformulation, confirmation) |
| **CdC fourni** | un document structuré existe déjà (cahier des charges, spec v-n, même volumineux) — exemple réel : [`../ExempleCdc.md`](../ExempleCdc.md), BilanSocle v5.0, ~800 lignes | M0/M1 s'**extraient** : SPEC produite depuis le CdC avec **traçabilité §CdC → US/RG** ; les trous, contradictions et non-dits du CdC deviennent les `[À ARBITRER]` ; le CdC reste la référence contractuelle, la SPEC l'artefact opératoire. La valeur de M1 n'est plus la rédaction : c'est la **transformation en artefacts prouvables** + la détection des trous |

## Dimension 2 — le profil (contexte)

| Profil | Artefacts requis | Arrêts pilote | Pour |
|---|---|---|---|
| **express** | M0 (vision+casting) · M1 (concepts, RG, `[À ARBITRER]` — proportionné au sujet) · M4 · matrice M6 (US→brique→test→gate) · 1 à 2 phases | 3 : ① vision ③ arbitrages ⑥ go | feature courte, domaine connu, zéro enjeu contractuel |
| **solo** | `conception/` complet (chaîne + RG en fiches + habilitations + plan de test) | 6 (cf. PILOTE) | app interne, produit LMVI |
| **client** | les 3 piliers (conception + conformité + run) | 6 + PV à chaque gate | chantier contractuel, équipe, client pilote |

**Passage de profil** : un express qui grossit **monte** en solo (les artefacts existants sont
conservés, on ajoute) ; on ne descend jamais de profil en silence — c'est une décision M4.

## En-deçà du seuil : ne rien dérouler

Si **l'intention tient dans un message et se prouve par un test** (fix, réglage, spike jetable,
geste d'exploitation), on ne déroule **aucune** méthode — on fait, on prouve, on journalise
(commit / tracking du chantier parent). L'issue d'un spike peut alimenter un M4. Une méthode
déroulée sur un fix de 2 heures est le meilleur moyen de la faire contourner ensuite.

## Choisir en 20 secondes

1. Ça tient dans un message + un test ? → **rien** (seuil).
2. Un CdC/une spec existe ? → mode d'entrée **CdC fourni** (sinon **besoin exprimé**).
3. Contractuel / client / équipe ? → **client**. App interne complète ? → **solo**.
   Feature courte sans enjeu ? → **express**.
