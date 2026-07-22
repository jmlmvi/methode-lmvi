<!-- KIT-VERSION: 1.8.0 -->
# Méthode AgileIA — construire une app TheSocle

> La **méthode générique** pour bâtir n'importe quelle app TheSocle (solo ou équipe cliente), avec
> son **corpus d'inputs techniques** et le **contrat d'architecture** commun. Une app (ex. Régie)
> est une **instance** : elle copie le kit et remplit les slots. Plateforme : **TheSocle 5.8**.
>
> 👉 **Pour démarrer un chantier : [`USAGE.md`](USAGE.md)** (pas-à-pas + prompts prêts à coller).

## Le repo en un coup d'œil

```
methode-AgileIA/
├── ESSENTIEL.md              ← LIRE EN PREMIER : la philosophie en 1 page (preuve externe, 3 axes)
├── USAGE.md                  ← puis le mode d'emploi (pas-à-pas + prompts + PILOTE)
├── CONTRAT-ARCHITECTURE.md   ← les règles plateforme héritées par toute app (jamais redécidées)
├── CHANGELOG.md              ← versions du kit (cadence : 1 version = 1 RETEX de chantier réel)
│
├── conception/               ← PILIER 1 : concevoir et prouver
│     la chaîne M0→M7 (METHODE + templates + générateur + PROMPT-PILOTE)
│     + RG · habilitations · tests · parcours/maquettes · interfaces/reprise
├── conformite/               ← PILIER 2 : le contractuel & légal
│     PV de recette · RGPD · risques · avenants · audit trail
├── run/                      ← PILIER 3 : la vie après la livraison
│     environnements · exploitation · CI/revue · doc & formation
│
├── inputs-corpus/            ← les 9 slots d'inputs techniques (0→8) qu'une app instancie
└── AnalyseFable/             ← les revues critiques du kit (archives datées)
```

**Un pilier = une famille d'artefacts**, activée selon le **profil** déclaré au casting M0
(`conception/PROFILS.md` : express / solo / client, + mode d'entrée besoin-exprimé / **CdC
fourni**). La chaîne M0→M7 vit dans `conception/` parce que concevoir est le cœur de la méthode —
les deux autres piliers ajoutent leurs artefacts aux mêmes maillons.

**Cadence du kit** : chaque template porte `PROUVE-SUR:` (les chantiers réels qui l'ont éprouvé —
« — » = encore ⚗️ spéculatif). Le canonique est **gelé pendant un chantier** (frictions notées
dans l'instance, `KIT-FRICTIONS.md`) ; **une version du kit = un RETEX de chantier réel**
(`conception/TEMPLATE-RETEX.md`).

## Comment ça s'articule

```mermaid
flowchart LR
  subgraph KIT["Ce repo (générique)"]
    C["conception/ (M0→M7 + RG/hab/tests)"]
    CF["conformite/"] 
    R["run/"]
    CORP["inputs-corpus/ (9 slots)"]
    CONTRAT["CONTRAT-ARCHITECTURE"]
  end
  KIT --> INST["Instance = dossier du chantier dans l'app<br/>(_kit copié + inputs/ remplis + tracking/)"]
  INST --> CODE["App (code, phase par phase)"]
```

## Le cycle de vie d'un chantier

| Étape | Maillons | Ce qui s'y passe | Et les tests ? |
|---|---|---|---|
| **1 · Cadrage & spécification** | M0 → M1 → M2 → M3 | vision confirmée, spec (QUOI + RG + habilitations + NFR), US, features, épics | la **matière des tests** s'écrit ici : CA des US + exemples/contre-exemples des RG — avant tout code |
| **2 · Arbitrage** | M4 | toutes les décisions structurantes tranchées — **on ne code pas avant** | — |
| **3 · Plan** | M5 → M6 | phasage gaté, plan technique, matrice de couverture (colonne Tests), mapping IAM | le **plan de test** se décide ici : automatisé vs démo, non-régression |
| **4 · Réalisation** (répétée par phase P-x) | M7 puis P-0, P-1… | câblage, puis code par incréments | les tests s'écrivent **avec** le code (squelettes Gherkin générés) |
| **5 · Recette** | la **gate** de chaque P-x | démo réelle validée par le commanditaire | + re-run de toutes les gates précédentes (non-régression) |
| **6 · Livraison** | à chaque gate passée | build → registre → déploiement | incrémentale — jamais de big-bang final |

**La clé** : recette et livraison ne sont pas des étapes finales — chaque phase P-x est un
**mini-cycle complet** (dev → tests → recette → livraison).

## Les non-négociables

**Preuve externe pour tout artefact** · **zéro mock / simulation / faux vert** (sans dépendance
réelle → état honnête `en_attente`) · **gate = démo réelle**, jamais une liste cochée ·
**décisions avant plan** (M4 bloquant) · **un artefact = un axe** — hiérarchie métier
**Épic → Feature → US** ; le mapping inter-axes vit dans la seule matrice de couverture (M6) ·
**réutilisation plateforme** (le contrat d'architecture s'hérite, ne se redécide pas) ·
**relecture requise M1/M4/M6** par un relecteur différent en nature.

## Le chapeau U-DOCS

Ce repo est le côté **forward** du référentiel `2026-U-DOCS` (le backward est `RefonteApplication`,
dont la rétro-spec alimente ce kit en mode « CdC fourni ») : [`../README.md`](../README.md) ·
doctrine commune [`../DOCTRINE.md`](../DOCTRINE.md) · vocabulaire partagé
[`../GLOSSAIRE.md`](../GLOSSAIRE.md) (§3 : correspondance rétro-spec → M0→M7) ·
[`../CHARTE-DOCUMENTAIRE.md`](../CHARTE-DOCUMENTAIRE.md). *(Liens valides quand le repo vit dans
U-DOCS ; cloné seul ou vendoré en `_kit/`, se référer au repo chapeau.)*

## Instances connues
- **Régie (APP-16)** — 1ʳᵉ instance : `APP-16-REGIES/docs/atelier-decomposition/` (kit v1.0.0
  vendoré, à resynchroniser).

## Resync d'une instance

Chaque fichier du kit porte `<!-- KIT-VERSION: x.y.z -->` ; une instance copie le kit à une version
donnée (dossier `_kit/`). Pour resynchroniser :
1. **Comparer** la `KIT-VERSION` de l'instance au [`CHANGELOG.md`](CHANGELOG.md) → versions manquantes.
2. **Reporter** les changements pertinents (décrits par version) ; toute divergence volontaire = décision M4 de l'instance.
3. **Marquer** la nouvelle `KIT-VERSION` dans l'instance.

## Reste à faire
- ⏳ Aligner le slot #1 du corpus sur la version framework 5.8.x exacte.
- ⏳ Resynchroniser l'instance Régie (kit v1.0.0 → courant).
