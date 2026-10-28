# socle-pack-mail — HOWTOs par fonctionnalité

**Le pack en cinq lignes.** `eu.lmvi:socle-pack-mail` est une bibliothèque qu'une application V005
embarque pour travailler le courriel **de l'intérieur de l'app**. Mode « contacts » : importer la
boîte d'un utilisateur (IMAP, Gmail, CSV Outlook) en référentiel de contacts, rédiger par LLM, envoyer
depuis sa propre boîte avec plages et quota, épurer des corps de messages. Mode « application »
(1.4.0) : relever la boîte de l'app et remettre chaque courriel à son code, ouvrir un compte IAM par
lien d'activation. Héberger les boîtes, scanner les pièces jointes et envoyer le courriel applicatif
restent des **services du Hub**, que le pack ne réimplémente pas.

## Version documentée

| | |
|---|---|
| Version | **1.5.0** (CHANGELOG daté du 2026-10-28) — tag `v1.5.0` |
| Source | `/opt/2026-TheHub4TheSocle/socle-pack-Mail/`, branche `main` (origine `github.com/jmlmvi/socle-pack-Mail`) |
| Réf. git | **commit `a396ada`** (tag annoté `v1.5.0`, poussé) ; la 1.4.0 est le commit `23d3d07` (tag `v1.4.0`) |
| Statut | commitée, taguée, installée dans `~/.m2` de la box de build. Publiée sur aucun dépôt distant : la vendoriser (MAIL-01) |
| Socle | `socle-v005` **5.10.0** (`minSocleVersion` du manifeste), Spring Boot **4.1.2**, `socle-pack-ai` **2.8.0** |
| Lignée précédente | **1.4.0** pour socle 5.8.x-5.9.x / Boot 4.0.6 / pack-ai 2.7.x |
| Tests | 145, 0 échec, 0 sauté (surefire), dont un démarrage `SpringApplication` complet (socle 5.10.0 + pack-ai 2.8.0, PostgreSQL pgvector) ; PostgreSQL 17 réel, GreenMail 2.1.8 |
| Vérifié | au code et à l'exécution, le **2026-10-28** |

## Besoin → HOWTO

| Besoin | HOWTO |
|---|---|
| Ajouter le pack à une app, migrations, noms de beans, clés | [[howto-mail-01-integrer-le-pack\|MAIL-01 — Intégrer le pack]] |
| Lire l'historique d'une boîte d'utilisateur et en tirer des contacts | [[howto-mail-02-importer-une-boite-utilisateur\|MAIL-02 — Importer une boîte utilisateur]] |
| Envoyer au nom d'un utilisateur, depuis sa boîte, avec plages et quota | [[howto-mail-03-envoyer-depuis-la-boite-utilisateur\|MAIL-03 — Envoyer depuis la boîte utilisateur]] |
| Rédiger un courriel personnalisé par LLM, avec explication | [[howto-mail-04-generer-un-mail-contextualise\|MAIL-04 — Générer un mail contextualisé]] |
| Retirer citations, en-têtes recopiés et signatures de corps stockés | [[howto-mail-05-epurer-les-messages\|MAIL-05 — Épurer les messages]] |
| Traiter le courrier reçu par l'adresse de l'application | [[howto-mail-06-relever-une-boite-applicative\|MAIL-06 — Relever une boîte applicative]] |
| Ouvrir un compte IAM à une personne par lien envoyé par courriel | [[howto-mail-07-lien-dactivation-de-compte\|MAIL-07 — Lien d'activation de compte]] |

## Pack ou Hub ?

| Besoin | Voie |
|---|---|
| Boîtes, domaines, DKIM, MX, quotas | Hub — [[howto-11-configurer-james-mail\|HOWTO 11]] |
| Antivirus des pièces jointes | Hub — `mail_attachment_worker`, [[howto-21-clamav-mail-scan\|HOWTO 21]] |
| Courriel transactionnel de l'app (accusé, lien d'activation) | Hub — `mail_worker.send_templated_email` |
| Contenu d'une boîte **d'utilisateur**, envoi **depuis** sa boîte, génération, épuration | pack — MAIL-02 à MAIL-05 |
| Relève de la boîte de l'app, page d'activation | pack — MAIL-06, MAIL-07 (la boîte et l'IAM restent au Hub) |

## Dépendances

- **`socle-pack-ai`** 2.8.0, en `provided` : l'application le déclare et le configure
  ([[howto-ai-01-integrer-le-pack|HOWTO AI-01]]). Requis par `mail_generation_worker`.
- Fournies par l'hôte : `socle-v005` (qui apporte OkHttp `okhttp-jvm` 5.5.1, disruptor 4.0.0, gRPC
  1.85.1), `spring-boot-starter-jdbc`, `spring-boot-starter-web`, pilote PostgreSQL, Jackson.
- Embarquées : `jakarta.mail-api` 2.1.5 + `angus-mail` 2.0.5 (versions gérées par Boot 4.1.2, sans
  version écrite dans le pom du pack), jsoup 1.17.2. Jusqu'en 1.4.0 : `com.sun.mail:jakarta.mail`
  2.0.1, OkHttp 4.12.0 et disruptor 3.4.4 embarqués.
- Hub (mode application) : James, `iam_worker` (clé IAM du compte de service), proxy (`sso.publicPaths`).

## Applications consommatrices

- **APP-98 TheIdeaBox** — vendorise `socle-pack-mail` 1.4.0 (`theideabox/mvn-repo/`) et déclare
  `/activation/**` en chemin public ; la dépendance n'est **pas encore déclarée** dans son `pom.xml`
  (suivi : « socle-pack-mail 1.4.0 codé, 144 tests verts ; gate sur la recette »). C'est pour elle
  qu'ont été écrites la boîte applicative et l'activation. ⚠️ Elle est en Boot 4.0.6 : elle reste
  donc sur la lignée 1.4.0, dont les défauts de démarrage (corrigés en 1.5.0, ci-dessous) l'empêcheront
  de démarrer dès qu'elle déclarera la dépendance — à trancher : monter l'app en socle 5.10 / pack
  1.5.0, ou une 1.4.1 rétroportant les trois correctifs.
- **APP-18 SDR2** — origine du moteur d'épuration et de `SignatureParser`
  (`docs/CONVERGENCE-SDR2.md`) ; ne dépend pas du pack.
- Aucune autre `APP-*` ne déclare le pack (recherche des `pom.xml` du 2026-10-28).

## Écarts relevés entre documentation et code (le code fait foi)

| Affirmation | Code 1.5.0 |
|---|---|
| Lecture Vault des identifiants par utilisateur (README, `CLAUDE.md`) | jamais active : `appId` = partition = `null` (`safePartition`) et le socle ne publie aucun bean Vault lisible (5.9.5 comme 5.10.0) → import en `source_config` obligatoire, **envoi impossible sans résolveur de l'hôte** (MAIL-03) |
| Synchronisation incrémentale quotidienne | inerte : le poller ne lit que Vault |
| Reprise après crash via `last_offset` | `last_offset` lu, jamais écrit |
| RLS TENANT_AND_OWNER, triggers `trg_x_partition_default` (`CLAUDE.md` du pack), « RLS bi-axe » (HOWTO 28) | **aucune** politique RLS ni trigger dans les migrations ; isolation par `owner_user_id` dans les requêtes ; RLS de l'hôte prise en charge par `FournisseurTenant` pour l'épuration seulement |
| « La signature épurée alimente le référentiel contacts » (1.2.0) | `SignatureParser` n'est appelé par aucun composant du pack |
| « Plus aucun nom de table en dur » | vrai pour `adapter/` ; les workers import/envoi/génération écrivent encore `tr_import_log`, `tr_mail_envoye`, `z_mail_config`… en dur |
| `store_in_sent` « stocke dans Sent » | n'écrit que la table `tr_mail_envoye` |
| `V999` pose le prompt `contextual_mail` | dans `public.z_config_ia` alors que pack-ai lit `${SOCLE_AI_SCHEMA}` ; peut ne rien poser, ou faire échouer le démarrage (MAIL-04) |
| README : « liste exhaustive des 20 variables » (`docs/ENV-REFERENCE.md`) | le manifeste en déclare 54, dont 26 nouvelles en 1.4.0 |
| HOWTO 28 : Vault `apps/{appId}/users/{userId}/mail/*` | code : `soclehub/apps/{appId}/users/{userId}/imap\|gmail` |

Défauts de montage restants : `V000` écrit dans `public` (refusé à un rôle applicatif sur
PostgreSQL ≥ 15) ; `z_pack_migrations` tenue par pack et non par schéma ; `V999` cherche
`z_config_ia` dans **tout** schéma mais insère dans `public.z_config_ia` — une app qui a **déjà**
pack-ai dans un schéma ≠ `public` et ajoute pack-mail voit le démarrage refusé (MAIL-04).

Corrigés en **1.5.0** :

- beans homonymes avec pack-ai (`packMigrationRunner`, `vaultCredentialResolver`) : tous les beans du
  pack sont nommés `mail*` (pack-ai 2.8.0 a fait de même en `ai*`) ; plus de générateur de noms à
  poser dans l'app ;
- `VaultCredentialResolver` injecté par `@Autowired(required=false) Object` → l'application hôte ne
  démarrait pas (`NoUniqueBeanDefinitionException`) ;
- `ActivationController` à deux constructeurs non désignés → échec du démarrage dès
  `SOCLE_MAIL_ACTIVATION_ENABLED=true` ;
- `mail_epuration_worker` jamais créé dans une app (`@ConditionalOnBean(DataSource)` évalué avant le
  DataSource de Boot) ;
- README du pack : exemples `curl …/api/actions/…` (porte du Hub) remplacés par `POST /mcp`,
  « TheSocle V005 ≥ 5.0.0 » remplacé par le tableau de compatibilité.

Ces trois défauts de démarrage existaient en 1.4.0 : une app restée en 1.4.0 (Boot 4.0.6) doit
s'attendre à les rencontrer.
