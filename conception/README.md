<!-- KIT-VERSION: 1.4.1 -->
# Pilier CONCEPTION — la méthode M0→M7 · RG · Habilitations · Tests

> **LE kit de conception** : la chaîne complète Besoin→Plan (M0→M7) + les artefacts que le client
> signe (RG, habilitations) + la preuve (tests). Premier des 3 piliers du kit
> (conception / [conformité](../conformite/) v1.5 / [run](../run/) v1.6), activés via le casting M0.
> Copier **ce dossier** comme `_kit/` d'un nouveau chantier (cf. [`../USAGE.md`](../USAGE.md)).

- 📘 **[`METHODE-Besoin2Plan.md`](METHODE-Besoin2Plan.md)** — la méthodologie de référence (M0→M7,
  3 axes, piliers, boucles de retour, matrice de couverture). **À lire en premier.**
- 🛠️ **[`gen-fiches-us.py`](gen-fiches-us.py)** — générateur **générique** : fiches US/Épic/RG,
  matrice d'habilitations, squelettes de tests Gherkin. Données dans un **YAML externe** :
  `python3 gen-fiches-us.py <us-data.yml>` — modèle : [`us-data.example.yml`](us-data.example.yml).
- 🎛️ **[`PROMPT-PILOTE.md`](PROMPT-PILOTE.md)** — **LE prompt unique** qui déroule tout le chantier
  M0→M7 (l'agent avance seul, ne s'arrête qu'aux 6 décisions du commanditaire, tient `PILOTAGE.md`).
- 💬 **[`PROMPT-generer-fiches-US.md`](PROMPT-generer-fiches-US.md)** — (re)générer les fiches
  (script **ou** prompt agent IA).

## Les templates

| Template | Pour |
|---|---|
| [`TEMPLATE-M0-vision.md`](TEMPLATE-M0-vision.md) | M0 · Vision + **casting** + piliers activés |
| [`TEMPLATE-M1-spec-besoins.md`](TEMPLATE-M1-spec-besoins.md) | M1 · Spec de besoins (+ NFR, révisions) |
| [`TEMPLATE-M2-user-stories.md`](TEMPLATE-M2-user-stories.md) · [`TEMPLATE-US.md`](TEMPLATE-US.md) | M2 · index + **fiche US** (axe métier seul) |
| [`TEMPLATE-M3-epics.md`](TEMPLATE-M3-epics.md) · [`TEMPLATE-EPIC.md`](TEMPLATE-EPIC.md) | M3 · index + **fiche épic** |
| [`TEMPLATE-M4-arbitrages.md`](TEMPLATE-M4-arbitrages.md) | M4 · Arbitrages |
| [`TEMPLATE-M5-phasage.md`](TEMPLATE-M5-phasage.md) | M5 · Phasage gaté (+ convention de préfixe) |
| [`TEMPLATE-M6-plan-technique.md`](TEMPLATE-M6-plan-technique.md) | M6 · Plan + matrice (colonne Tests) + mapping IAM |
| [`TEMPLATE-M7-execution.md`](TEMPLATE-M7-execution.md) | M7 · Exécution & câblage (+ suivi par phase) |
| [`TEMPLATE-RG.md`](TEMPLATE-RG.md) | **fiche règle de gestion** (M1 — typée, tracée, testable) |
| [`TEMPLATE-HABILITATIONS.md`](TEMPLATE-HABILITATIONS.md) | **matrice rôle × US** (M1, signée métier) + mapping IAM (M6) |
| [`TEMPLATE-TESTS.md`](TEMPLATE-TESTS.md) | **plan de test par phase** (M6.5, gate scriptée) |

**Règle** : chaque instance remplace les `{{placeholders}}`, garde la section **Relations (mermaid)**,
et vérifie sa **DoD** avant le maillon suivant. Relecture **requise** M1/M4/M6. Versions :
`KIT-VERSION` en tête de chaque fichier + [`../CHANGELOG.md`](../CHANGELOG.md).

## Le modèle de test aligné sur les 3 axes (doctrine)

Pas de mapping naïf « US→unitaires, épic→intégration » (même piège que « 1 épic = 1 worker ») :
**US → ≥ 1 test d'acceptation** (ses CA, `@US-<code>`) · **RG → ≥ 2 tests** (conforme + rejet,
`@RG-<code>`) · **épic → rollup** par tag · **brique → unitaires/intégration technique** ·
**phase P-x → gate scriptée** (acceptation + non-régression des phases précédentes + démo du
non-automatisable) · **app → E2E/smoke**. Calibrage : acceptation **API par défaut**, UI/E2E réservé
aux `@pivot` ; unitaires où il y a de la vraie logique ; pas de dogme de % de couverture.

## Doctrine habilitations (frontière RBAC / RG)

Le **RBAC gros grain** vit dans l'IAM Hub (rôles/scopes du `manifest.json`, vérifiés au proxy —
contrat d'architecture §5). Les **conditions fines** (ownership, états…) sont des **RG de type
`droit_acces`**, appliquées dans le code. Pas de moteur ABAC maison (anti-extrapolation).

## Génération automatique

Le générateur consomme les sections optionnelles `rg:` et `roles:` du YAML et produit :
`M1-spec-besoins/RG/` (1 fiche/RG + index + RG orphelines signalées) ·
`M1-spec-besoins/matrice-habilitations.generated.md` (✅ dérivés des acteurs, `?` à qualifier) ·
`tests-squelettes/` (Gherkin `@US-x` / `@RG-x`, **à déplacer dans le repo de code**).
