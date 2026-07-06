# Contrat d'architecture plateforme TheSocle

> **Le document transversal** : les **règles/décisions plateforme que TOUTE app TheSocle hérite** — le
> *« où / comment »* commun (stockage, APIs, base, secrets, identité, déploiement, front, qualité).
> C'est un **input de premier plan** de la méthode (slot 8 du corpus). Une app ne redécide pas ces
> points : elle **s'y conforme**. Version plateforme : **TheSocle 5.8 (5.8.0)**.

---

## 1. Stockage des éléments → **S3 (MinIO)**
- Tous les **médias / fichiers / artefacts** sont stockés sur **S3 (MinIO)** via `storage_worker` — jamais
  sur le disque local du conteneur (les volumes sont **éphémères**).
- La base ne stocke que la **référence** (`bucket`, `key`), pas le binaire.
- Buckets par app / par projet, quotas gérés par le Hub.

## 2. APIs → **appelées via le Hub (APIM)**
- Les appels **sortants** et **inter-apps** passent par le **Hub / APIM** (`api.thesocle.net`) — pas de
  couplage direct app↔app.
- **LLM** : via l'**API LLM du Hub (APIM)** / `socle-pack-ia` — modèle paramétrable (ex. minimax) + **fallback**.
  **Aucune clé / provider LLM en dur** dans une app.
- Clés/quotas APIM = format `apim_<env>_<hex>`, gérés côté Hub.

## 3. Base de données → **PostgreSQL standard THESOCLE**
- **1 schéma par app** (`schema_<app>`), rôle `app_<app>`.
- **Standard THESOCLE** : préfixes `z_` (paramétrage) / `db_` (référentiel) / `tr_` (transactionnel) ;
  colonnes système `x_*` (`x_id`, `x_partition`, `x_dateCreated`, `x_dateChanged`, `x_active`, `x_datas`…) ;
  **triggers** standard ; **owner = admin**.
- **Multi-tenant** : `x_partition` = tenant (une entreprise), jamais croisé entre tenants.
- Exception : hypertables TimescaleDB exemptées du standard (PK/x_*/triggers).

## 4. Secrets → **Vault**
- Tout secret (mots de passe DB, clés API, tokens) vit dans **Vault** (Hub) — **jamais en clair**, ni
  dans un fichier committé, ni dans une doc. Les env sensibles sont injectés au déploiement.

## 5. Identité → **IAM multi-tenant + SSO via le proxy Hub**
- **IAM** : rôles/scopes déclarés dans le `manifest.json` de l'app ; compte de service pour les agents.
- **Tenant** : `x_partition` dérivé de l'en-tête `X-SSO-Tenant`.
- **SSO** : porté par le **proxy du Hub** (en-têtes `X-SSO-User` / `X-SSO-Email`) ; l'app ne gère pas
  l'authentification, elle **lit** les en-têtes. Mode SSO (`none/optional/required`) au niveau de la route.

## 6. Déploiement → **image → registre → minihub (voie gérée)**
- Build **image Docker** (multi-arch si cible ARM) → **registre** `repository.thesocle.net` → **app gérée
  sur un minihub** (voie gérée, `apps_local`, visible/monitorée ; tunnel gRPC sortant ; **IP du minihub
  jamais exposée**).
- ⚠️ **Update d'une app déjà RUNNING** : l'install distribué la traite en **REFERENCE** (no-op) →
  l'update réel = **SSH recreate** sur la box, en réutilisant l'env exact + label `managed=true`.
- Après update : `update_route(target_host=…)` ; `set_env_var` seul ne propage pas.

## 7. Frontend → **shell React V005 (design system)**
- **React + shell V005** (IDELayout, Cmd+K, ThemePalette, pattern `appdemo`).
- **Charte TheSocle** : logomark **violet `#863bff` / `#7e14ff`** (pas de vert).
- App front `sso-optional` partagée multi-Hub : whitelister les origines côté Hub.

## 8. Résilience → **GatewayWorker pour tout appel externe**
- Tout accès à un système externe passe par un **GatewayWorker** (circuit breaker + retry + rate-limiter
  câblés). Jamais de `new Thread`/`while(true)`/`@Scheduled` dans un Worker.

## 9. Observabilité → **TechDB + Status Dashboard**
- Métriques / logs / actions / résultats d'API dans la **TechDB** (port dashboard 9374) ; lecture via
  `techdb_reader_worker`.

## 10. Services Hub disponibles (à réutiliser, ne pas recoder)
`iam` · `vault` · `storage (S3/MinIO)` · `mail (James)` · `clamav (scan uploads)` · `backup (→S3)` ·
`apim` · `agentia / pack-ia (LLM)` · `proxy` · `dns` · `acme (TLS)` · `signature` · `tsa` · `nats` ·
`cache` · `cosmo (cal/contacts)` · `onlyoffice` · `status/techdb`.

## 11. Qualité → **clause LMVI**
- **Zéro mock / simulation / régression.** Sans dépendance réelle → état **honnête** (`en_attente`),
  jamais un faux résultat. **Preuve réelle à chaque gate** (démo, pas coche de tâche).
- Versionner (pom + build.properties + tag Docker) en même temps que les correctifs.

---

> **Comment une app l'utilise** : elle **ne réécrit aucun** de ces points ; son plan technique (M6) et son
> câblage (M7) **s'y réfèrent**. Toute dérogation doit être une **décision explicite** (maillon M4).
