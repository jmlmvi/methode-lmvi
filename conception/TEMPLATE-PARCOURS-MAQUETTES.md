<!-- KIT-VERSION: 1.5.0 -->
# Parcours & maquettes — {{nom du chantier}}

> Template **optionnel mais fortement recommandé en contexte client** : le client valide sur des
> **écrans**, pas sur du texte. Se place **entre M2 et M5** : on maquette les **US pivots** avant
> de phaser, on valide avant M6 — jamais de découverte de l'UI à la recette.

## 1. Périmètre
On ne maquette pas tout : les **US pivots** (`@pivot`) + les écrans structurants (navigation,
objet central). Le reste suivra le design system sans maquette.

| Parcours | US couvertes | Écrans | Maquette (lien) | Statut |
|---|---|---|---|---|
| {{ex. déposer → décomposer → valider}} | {{A1, C1, F1}} | {{3}} | {{Penpot/PNG}} | à valider |

## 2. Règles plateforme (contrat d'architecture §7 — on ne redécide pas)
Shell **React V005** (IDELayout, Cmd+K, ThemePalette, pattern `appdemo`) · charte TheSocle
(logomark violet `#863bff`/`#7e14ff`) · SSO porté par le proxy (pas d'écran de login à maquetter).
La maquette choisit la **disposition et le parcours**, pas le style de base.

## 3. Chaque parcours, en une page
- **Enchaînement** : {{écran 1 → action → écran 2 …}} (mermaid ou flèches)
- **Ce que l'écran promet** : reprendre les **CA des US couvertes** — un CA invisible à l'écran
  est un signal (CA mal écrit ou écran incomplet).
- **États** : vide · chargement · erreur · `en_attente` (clause zéro-mock : l'attente honnête se
  voit à l'écran, on la maquette).

## 4. Validation
Le commanditaire valide **chaque parcours** (c'est une mini-gate documentaire). Un changement
demandé après validation = rétro-propagation (§2.2) et, en contexte client, fiche
`conformite/TEMPLATE-AVENANT.md` si le périmètre bouge.

## 5. Definition of Done
- [ ] Toutes les US `@pivot` couvertes par un parcours maquetté
- [ ] Chaque écran porte les CA de ses US (aucun CA orphelin d'écran)
- [ ] États vide/erreur/`en_attente` maquettés
- [ ] Parcours **validés par le commanditaire avant M6**
