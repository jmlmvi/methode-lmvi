<!-- KIT-VERSION: 1.1.0 -->
# Kit méthode Besoin → Plan (méthodologie + templates)

Kit **réutilisable et autoportant** pour instruire un nouveau chantier. Contient **la méthodologie
complète** + un squelette par maillon. Copier ce dossier comme modèle, ou reprendre maillon par maillon.
Version du kit : voir `KIT-VERSION` en tête de chaque fichier + [`CHANGELOG.md`](CHANGELOG.md).

- 📘 **[`METHODE-Besoin2Plan.md`](METHODE-Besoin2Plan.md)** — la méthodologie de référence (M0→M7,
  3 axes, boucles de retour, matrice de couverture, principes). **À lire en premier.**
- 🛠️ **[`gen-fiches-us.py`](gen-fiches-us.py)** — générateur **générique** des fiches US/Épic (nommées,
  reliées `[[…]]` + mermaid), déterministe & idempotent. Données dans un **YAML externe** :
  `python3 gen-fiches-us.py <us-data.yml>` — modèle : [`us-data.example.yml`](us-data.example.yml)
  (le chantier Régie).
- 💬 **[`PROMPT-generer-fiches-US.md`](PROMPT-generer-fiches-US.md)** — comment (re)générer les fiches
  (via le script **ou** via un prompt pour agent IA).
- 🧾 **[`CHANGELOG.md`](CHANGELOG.md)** — l'historique des versions du kit (base du resync des
  instances, cf. README racine).

| Template | Pour le maillon |
|---|---|
| [`TEMPLATE-M0-vision.md`](TEMPLATE-M0-vision.md) | M0 · Vision (+ rôles commanditaire/relecteur) |
| [`TEMPLATE-M1-spec-besoins.md`](TEMPLATE-M1-spec-besoins.md) | M1 · Spec de besoins (+ NFR, révisions) |
| [`TEMPLATE-M2-user-stories.md`](TEMPLATE-M2-user-stories.md) | M2 · index des User Stories |
| [`TEMPLATE-US.md`](TEMPLATE-US.md) | **une fiche US** (1 fichier/US, dans M2 — axe métier seul) |
| [`TEMPLATE-M3-epics.md`](TEMPLATE-M3-epics.md) | M3 · index des Épics |
| [`TEMPLATE-EPIC.md`](TEMPLATE-EPIC.md) | **une fiche Épic** (1 fichier/épic, dans M3) |
| [`TEMPLATE-M4-arbitrages.md`](TEMPLATE-M4-arbitrages.md) | M4 · Arbitrages |
| [`TEMPLATE-M5-phasage.md`](TEMPLATE-M5-phasage.md) | M5 · Phasage gaté (+ convention de préfixe) |
| [`TEMPLATE-M6-plan-technique.md`](TEMPLATE-M6-plan-technique.md) | M6 · Plan technique + couverture + stratégie de test |
| [`TEMPLATE-M7-execution.md`](TEMPLATE-M7-execution.md) | M7 · Exécution & câblage (+ suivi par phase) |

**Règle** : chaque instance remplace les `{{placeholders}}`, garde la section **Relations (mermaid)**,
et vérifie sa **Definition of Done** avant de passer au maillon suivant. Relecture **requise** pour
M1, M4 et M6 (méthode §1).
