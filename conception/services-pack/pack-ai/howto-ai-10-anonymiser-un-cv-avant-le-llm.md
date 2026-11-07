# AI-10 — Anonymiser un CV avant de le faire lire par un LLM

**Cible :** `eu.lmvi:socle-pack-ai:2.10.0` · socle-v005 5.11.0 (minimum 5.10.0) · Spring Boot 4.1.2
**Composants :** `AnonymisationService` (bean `aiAnonymisation`), `DocsParserClient.parseBytes`
**Service du Hub consommé :** `hub-docs-parser` (`POST /v1/parse_bytes`, OCR Tesseract)
**Spec :** `socle-pack-ai/docs/AgentIA/sous-specs/SPEC-ANONYMISATION-CV-V001.md` (validée le 2026-11-07)

---

## 1. Contexte

Une app veut qu'un LLM lise un CV pour en tirer expériences et compétences, **sans que rien
d'identifiant ne sorte de la plateforme**. Le pack retire, par règles et sans LLM, tout ce qui
identifie la personne, vérifie le résultat, et refuse s'il reste un élément.

## 2. Ce qui est retiré, ce qui reste

| Retiré (repère) | Gardé |
|---|---|
| nom, prénoms (`[NOM]`, `[PRÉNOM]`) — indices de l'app + recoupement (prénoms INSEE en tête, partie locale du courriel, identifiant LinkedIn) | intitulés de poste, employeurs, compétences, dates d'expérience |
| courriel, téléphone (FR et international), NIR (`[IDENTIFIANT]`) | « 10 ans d'expérience », montants, pourcentages |
| date de naissance, âge, nationalité | langues (« anglais courant ») |
| adresse (rue, code postal + ville, ligne « Adresse : ») | « 3 cours de formation », « 2 places de marché » |
| **liens personnels** : plateformes de profils (LinkedIn, GitHub, Behance, Malt…), lien qui porte le nom, tout lien d'en-tête | liens d'entreprise ou de projet public hors en-tête |

Seul le **texte** est traité : ni la photo ni les métadonnées du fichier ne sont lues.

## 3. Étape 1 — Anonymiser un fichier déposé

```java
TexteAnonymise r = anonymisation.anonymiserFichier(octets, "cv.pdf",
        new IndicesIdentite(dossier.nom(), dossier.prenom(), dossier.courriel()));   // nom et prénom EXIGÉS
switch (r.statut()) {
    case ANONYMISE -> appelerLeLlm(r.texte());           // et montrer r.texte() au bénéficiaire (« ce qui a été lu »)
    case REFUSE_RESIDU -> proposerLaSaisieManuelle();     // ne JAMAIS appeler le LLM
    case TEXTE_VIDE, EXTRACTION_IMPOSSIBLE -> direPourquoi(r.statut());
}
log.info("anonymisation {}", r.versMap());               // jamais r.texte() dans un journal
```

`anonymiserTexte(texte, indices)` fait la même chose sur un texte déjà extrait.

## 4. Configuration

| Propriété | Défaut |
|---|---|
| `socle.ai.docs-parser-url` | `http://hub-docs-parser:8000` |
| `socle.ai.anonymisation.enabled` | `true` |
| `socle.ai.anonymisation.lignes-en-tete` | `8` |
| `socle.ai.anonymisation.prenoms-occurrences-min` | `20` |
| `socle.ai.anonymisation.plateformes-profils` | LinkedIn, GitHub, GitLab, Behance, Dribbble, Malt, X, Instagram… (§ 3.1 de la spec) |

## 5. Vérifier

`AnonymiseurTest` (7) et `AnonymisationFichierTest` (5) : vraie image `hub-docs-parser:latest` du Hub —
PDF texte, DOCX, PDF scanné et image lus par OCR, puis anonymisés.

## 6. Pièges courants

| Symptôme | Cause | Correction |
|---|---|---|
| `IllegalArgumentException` à l'import | nom ou prénom absent des indices | les faire saisir au dossier avant l'import (décision du 2026-11-07) |
| `REFUSE_RESIDU` fréquent | un élément identifiant de forme inattendue | ne pas contourner : saisie manuelle ; signaler la forme au pack (nouveau détecteur) |
| Un nom rare passe dans le texte | ni indice, ni prénom INSEE, ni courriel, ni LinkedIn | les indices de l'app sont la voie la plus sûre : vérifier qu'ils sont transmis |
| `EXTRACTION_IMPOSSIBLE` | `hub-docs-parser` injoignable, ou fichier illisible | vérifier `socle.ai.docs-parser-url` ; le fichier d'origine reste sur la plateforme |
| Le texte du CV dans les journaux | l'app a journalisé `r.texte()` | ne journaliser que `r.versMap()` |
