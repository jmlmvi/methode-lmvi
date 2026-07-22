<!-- KIT-VERSION: 1.7.1 -->
# Corpus d'inputs techniques TheSocle (générique)

> Les **inputs techniques standards** dont la méthode a besoin pour construire **n'importe quelle** app
> TheSocle. La méthode est **générique** ; une app (ex. Régie) **instancie** chaque slot en pointant/copiant
> la source. Version plateforme : **TheSocle 5.8 (5.8.0)**.
>
> Convention : un **slot = une brique** ; chaque instance d'app crée un `inputs/` qui **remplit ces slots**.

| # | Slot | Source canonique | Ce que l'app y prend |
|---|---|---|---|
| 0 | **Skeleton d'app (APP-ZZ-TEMPLATE)** | `/opt/2026-TheHub4TheSocle/APP-ZZ-TEMPLATE/` | **le squelette de départ** : plomberie DB/auth/SSO/scopes/tenant, Dockerfile, manifest, Application, SPA — `./bootstrap.sh` |
| 1 | **TheSocle 5.8 (5.8.0)** (noyau) | `docs/docs-socleV005/01-docsV2/` + JAR `socle-v005-5.8.0` | Workers, invariants (1 worker=1 fichier, injection ctor…), templates, actions/MCP, config |
| 2 | **TheSocleHub — catalogue de services** | doc Hub + MCP `admin.thesocle.net` | **APIs & agents & services** : `iam`, `vault`, `storage (S3)`, `mail (James)`, `clamav`, `backup`, `apim`, `agentia`, `proxy`, `dns`, `acme`, `signature`, `tsa`, `nats`, `cache`, `cosmo`, `onlyoffice`, `status/techdb` |
| 3 | **FrontEnd (React V005)** | shell React V005 + design system (`appdemo`, charte violet) | règles UI, IDELayout, Cmd+K, ThemePalette, composants, SSO front |
| 4 | **socle-pack-ia** | repo/pack `socle-pack-ai` | agents IA / LLM (via APIM), providers, quotas |
| 5 | **socle-pack-pipeline** | `/opt/2026-TheHub4TheSocle/socle-pack-pipeline/` | moteur DAG (stages S/T/E/G/K/H/C), reprise, lineage, `graph_view` |
| 6 | **MiniHub** | doc minihub + `reference_minihub_*` | déploiement distribué (voie gérée), tunnel gRPC, install/update |
| 7 | **Standard tables PGSQL (THESOCLE)** | `docs/docs-socleV005/…/specsTablesPgsql.md` + `191-postgresql-database-worker` | préfixes `z_/db_/tr_`, colonnes `x_*`, triggers, `x_partition`, owner admin |
| 8 | **[Contrat d'architecture](../CONTRAT-ARCHITECTURE.md)** | `../CONTRAT-ARCHITECTURE.md` | le *où/comment* transversal : **S3, APIs via Hub, APIM/LLM, minihub, Vault, IAM/SSO, no-mock** |

## Inputs « métier » (à la carte, selon l'app)
Au-delà des 9 slots socles (0→8), une app ajoute ses inputs propres : jeux de données, specs métier, APIs
tierces, gabarits… (ex. Régie : les sources `SHORT-XXX/`, la spec BA).

## Comment une app instancie le corpus
1. Créer `<app>/…/inputs/` avec un sous-dossier par slot utilisé.
2. Y **copier** les fichiers de référence nécessaires (copies de travail) **+** noter la **source
   canonique** et la **version copiée** (`KIT-VERSION` / version du JAR / date de copie) — c'est la
   base du resync (procédure : README racine, « Resync d'une instance »).
3. Le maillon **M7** (câblage) référence ce `inputs/`.

> Exemple instancié : **Régie** → `APP-16-REGIES/docs/atelier-decomposition/inputs/` (pack pipeline +
> framework V005 curé + baseline). Version de référence à aligner : **5.8.0 (ligne 5.8)**.
