# socle-pack-documents — les fichiers d'une app : antivirus avant garde, chiffrement au repos, quotas

> **Version documentée : 0.2.0** — dépôt `jmlmvi/socle-pack-documents`, branche locale
> `feat/analyse-sans-garder-0.2.0` (non poussée, non taguée au 2026-11-04 ; 0.1.0 = tag `v0.1.0`), jar vendorisé
> dans `mvn-repo/eu/lmvi/socle-pack-documents/0.2.0/`. Vérifié au code le **2026-11-04**.
> Coordonnées Maven : `eu.lmvi:socle-pack-documents:0.2.0` — Spring Boot 4.1.2, parent `eu.lmvi:socle-v005-parent`
> 5.11.2, compilé contre `socle-v005` 5.11.2 en `provided` (minimum 5.10.0).
>
> 🔴 **Le stockage du Hub `.net` n'a pas de clé KMS** (constaté en lecture le 2026-11-04 :
> `MINIO_KMS_SECRET_KEY_FILE=kms_master_key`, valeur par défaut de l'image, fichier absent). Le pack
> exige le chiffrement au repos (M4 Q12) : sur ce Hub, tout dépôt est refusé
> (`CHIFFREMENT_NON_GARANTI`) tant que la clé n'est pas posée. C'est un prérequis de plateforme.

## Le pack en cinq lignes

1. Il garde les fichiers qu'une app reçoit (CV, pièces, dépôts de cabinet) sur le **S3 du Hub**,
   **chiffrés au repos** (SSE-S3 demandé et vérifié), **après analyse par le ClamAV du Hub**.
2. Il refuse clairement, avec quoi faire : plus de 20 Mo, quota du propriétaire (200 Mo) dépassé,
   menace trouvée. Un antivirus muet ne vaut jamais « sain » : le fichier n'est pas gardé.
3. Il rend une **API Java** : `FichiersService` (déposer, lire, lister, occupation, supprimer) et,
   depuis 0.2.0, `AnalyseService` (analyser sans garder, fail-closed, plafond par appel). Aucune
   action métier en MCP, aucune adresse présignée.
4. Chaque appel sortant passe par un **`GatewayWorker`** du socle : délai et 5xx réessayés, 4xx
   échec immédiat.
5. Il ne fait pas (encore) les documents produits : modèles Word, PDF par OnlyOffice, PDF de secours
   viendront dans une version suivante du même pack (K-2 « documents », avant P-2).

## Ce que fait le pack, ce que fait le Hub

| Côté **Hub** | Côté **app** (ce pack) |
|---|---|
| pose le schéma de l'app (`db_worker.create_app_schema`) | y crée `tr_documents_fichier`, jamais le schéma |
| sert MinIO sur `soclehub-minio:9000` (howto-16) ; chiffre au repos **si** sa clé KMS est posée | demande `x-amz-server-side-encryption: AES256`, vérifie la réponse, retire l'objet sinon |
| sert ClamAV sur `soclehub-clamav:3310` et `clamav_worker/scan_bytes` (howto-21) | analyse chaque fichier avant de le garder ; menace = refus, panne = refus |
| `storage_set_quota` : **suspendu** dans le Hub, n'applique rien | plafond par fichier, quota par propriétaire, réservé sous verrou |
| remplit les variables `SOCLE_DOCUMENTS_*` depuis le coffre de l'app | les lit par `socle.documents.*` |

## Besoin → howto

| Besoin | Howto |
|---|---|
| Ajouter le pack à une app, le configurer, vérifier qu'il démarre et que le Hub est prêt | [[howto-documents-01-integrer-le-pack\|documents-01 — Intégrer le pack]] |
| Déposer, relire, lister, supprimer un fichier ; afficher le quota ; répondre à la personne | [[howto-documents-02-deposer-lire-supprimer\|documents-02 — Déposer, lire, supprimer]] |
| Analyser un fichier sans le garder (paquet officiel, pièce relayée) | [[howto-documents-02-deposer-lire-supprimer\|documents-02]] § 6 bis |
| Produire un Word ou un PDF depuis un modèle | à venir (K-2 documents) |

## Dépendances

| Dépendance | Portée | Pourquoi |
|---|---|---|
| `eu.lmvi:socle-v005` | `provided` | `AbstractGatewayWorker`, `Worker`, `ActionProvider` |
| `spring-boot-starter-jdbc` + `DataSource` PostgreSQL | `provided` | `tr_documents_fichier` dans le schéma de l'app, transaction du quota |
| `spring-boot-starter-log4j2` | `provided` | journalisation de l'app |

Aucune dépendance `compile`. S3 : client HTTP du JDK et signature V4 du pack. clamd : `Socket`.

## Contrat réel du Hub retenu (lu dans `soclehub` 784b428 et dans les apps qui l'emploient)

| Service | Ce que le pack appelle | Notes |
|---|---|---|
| Stockage | S3 `PUT`/`GET`/`HEAD`/`DELETE` par chemin sur `http://soclehub-minio:9000/<seau>/<clé>` | même voie que TheDiffuseur, BingFetch, NotionSocle (identifiants MinIO) ; `storage_worker` n'a ni SSE ni lecture d'octets, et son `storage_download_url` signe pour l'adresse interne |
| Antivirus (défaut) | clamd INSTREAM sur `soclehub-clamav:3310` | même démon que `clamav_worker` ; le contenu ne passe par aucun journal |
| Antivirus (option `hub`) | `POST /api/actions/clamav_worker/scan_bytes`, `{"data_base64": …}`, en-tête `X-Api-Key` (clé IAM) | réponse `{success, data: {clean, virus_name, raw_response, …}}` ; `clean:false` + `virus_name:""` = échec d'analyse ; 🔴 `WorkerActionController` journalise le corps en INFO (le fichier en base64) |

## Apps consommatrices (au 2026-11-04)

| App | Pack | Socle | Usage |
|---|---|---|---|
| APP-36-TheBeneficiaire (P-0) | 0.2.0 | 5.11.x | `DossierService`, `DepotService`, `ExportDossierService`, `SuppressionService` ; `Televersements` (paquets G1) par `AnalyseService` |

## Écarts relevés entre la documentation du pack et son code

Le code fait foi ; les howtos suivent le code.

| # | Documentation | Code |
|---|---|---|
| — | aucun relevé | |

## Pièges de plateforme connus

| Piège | Effet | Qui corrige |
|---|---|---|
| `StreamMaxLength` du clamd du Hub = 100 Mio (mesuré 2026-11-04, image 1.5.x) | au-delà, rien n'est analysé : le pack refuse d'avance (`REFUSE_TROP_GROS_POUR_ANTIVIRUS`) | Hub, s'il faut plus gros (puis `limite-flux-octets`) |
| `AlertExceedsMax` désactivé dans le clamd du Hub | un membre d'archive décompressé > 100 Mio n'est pas analysé et clamd rend « OK » | Hub (`AlertExceedsMax yes` rendrait `Heuristics.Limits.Exceeded FOUND`, que le pack traite en menace) |
