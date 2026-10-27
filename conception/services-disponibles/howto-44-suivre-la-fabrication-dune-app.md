# HOWTO 44 — Suivre la fabrication d'une application (salon + dossier TheDash)

> **Le besoin** : savoir, pour chaque application en construction, où elle en est et où le temps se
> perd. **La règle** : ça ne se tient pas à la main, et ça ne se réimplémente pas — le Hub rend déjà
> les salons, et TheDash rend déjà les tableaux.
>
> Spec et plan du dispositif : `docs/supervisionDeveloppement/`.

## Ce qui naît avec une application

À la création — jamais plus tard, jamais à la main :

| Objet | Nommage | Rendu par |
|---|---|---|
| un **salon** | le nom lisible de l'app, type `APPLICATION` | `salon_worker.salon_create` |
| un **dossier TheDash** | l'identifiant du dépôt (`APP-26B-IdeeBox`) | `files_worker.create_folder` |
| **quatre tableaux** dans ce dossier | V1 frise · V2 couloirs · V3 humain/agent · V4 carte | `templates_worker.apply_template` |

En une commande :

```bash
cd docs/supervisionDeveloppement/outils
python3 -I ouvrir_chantier.py --app APP-26B-IdeeBox --nom "IdéeBox"
# → Salon SAL-XXXX · dossier 158 · tableaux V1=…, V2=…, V3=…, V4=…
```

C'est **rejouable** : relancée, la commande réutilise le salon, le dossier et les tableaux déjà
posés. Elle écrit `docs/chantier/tracking/thedash.json` dans l'application : le salon, le dossier,
les quatre fichiers, et la carte `clé métier → identifiant d'élément`.

`--sec` montre ce qui serait fait sans rien faire. `--salon SAL-XXXX` réutilise un salon existant
plutôt que d'en ouvrir un (un salon ne se supprime pas : ne pas en créer pour essayer).

## Les quatre tableaux, et à quoi chacun répond

| Tableau | Répond à |
|---|---|
| **V1 · Frise et phases** | où en est-on ? Le cadrage M0→M6 tient en un bandeau ; les phases de livraison sont dépliées en *Développement · Tests · Attente de décision · Gate · Livraison* |
| **V2 · Couloirs par phase** | qu'est-ce qui reste dans la phase courante ? |
| **V3 · Humain vs Agent** | ce que chaque morceau a coûté, estimé contre mesuré, en deux échelles séparées |
| **V4 · Carte du parcours** | le parcours d'usage, la ligne d'eau, et ce qui attend une main humaine (Things) |

Les quatre portent le logo LMVI-Conseil et s'exportent en PDF.

## Les remplir

Les tableaux ne se tiennent pas à la main.

```bash
python3 -I synchroniser.py /opt/2026-TheHub4TheSocle/APP-XX-MonApp
# → V1 (fichier 347) : 0 créés, 96 mis à jour, 0 retirés, 0 écartés
```

`deliver.sh` l'appelle **à chaque livraison** : c'est le moment où le tableau doit dire vrai.

Ce qui est lu, et où :

| Source | Ce qu'on y lit |
|---|---|
| `docs/chantier/us-data.yml` | les épics, les US, leur épic et leur phase |
| `docs/chantier/M5-phasage/PHASAGE.md` | les phases livrables et leur intitulé |
| `docs/chantier/PILOTAGE.md` | le tableau « Mesures par maillon » : M0→M7, dates, latence de décision |
| `docs/chantier/tracking/suivi.yml` | **les états et les durées** — ce qu'aucun autre fichier ne sait |

`suivi.yml` est déposé vide à l'ouverture du chantier et **jamais écrasé ensuite**. Une durée non
relevée y reste absente : le tableau affiche « — ». On n'estime jamais à la place du réel, et une
estimation du départ ne se réécrit pas — sinon on ne mesure plus rien.

**Idempotent** : chaque élément porte une clé métier (`champs.cle` : `phase/P-2/tests`, `us/A1`,
`infra/pg`…) traduite en `x_id` par `tracking/thedash.json`. Rejouer ne duplique rien. Et ce que le
chantier ne porte plus est **retiré** du tableau — sans quoi un modèle appliqué garderait ses
éléments d'exemple, et le tableau mentirait d'autant plus qu'il aurait l'air rempli.

## Sortir un PDF

```json
export_worker.export { "file_id": 339, "format": "pdf" }
→ { "pages": 1, "width": 2984, "height": 1808, "bytes": 218890 }
```

`png`, `svg`, `markdown` et `csv` sont rendus de la même façon. ⚠️ Le **téléchargement** du fichier
passe par l'écran de TheDash (SSO) : la route d'export n'est pas ouverte sur un lien public.

## Les pièges, mesurés le 2026-10-21

- **`apply_template` par `name` ne trouve pas un modèle d'espace** — il ne cherche que les modèles
  globaux. Passer par `template_id` (cf. `outils/modeles.json`).
- **`files_worker.delete` refuse un fichier qui n'est pas à la corbeille** (RG-9) : `trash` d'abord.
- **`upsert_items` est idempotent par `x_id`, pas par clé métier.** Sans la carte, une deuxième
  passe crée 122 doublons au lieu d'en mettre 122 à jour.
- **Le logo passe par une url**, pas par une pièce jointe :
  `https://minio.thesocle.net/docs/supervision/logo-lmvi-conseil.png` (bucket `docs`, public).
- **Un salon ne se supprime pas.** Pour un essai, réutiliser un salon existant avec `--salon`.

## Voir aussi

- [[howto-41-salons-echanger-entre-sessions|HOWTO 41]] — le salon lui-même
- `docs/supervisionDeveloppement/SPEC.md` — ce que montre chaque tableau, et pourquoi
- `APP-ZZ-TEMPLATE/docs/01-CREER-UNE-APP.md` §3bis — l'étape à la création d'une app
