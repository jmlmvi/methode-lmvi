# HOWTO EGRESS-01 — Intégrer `socle-pack-egress` dans une application

**Niveau :** Confirmé
**Cible :** application V005 hors du réseau Docker du Hub (minihub, NUC, VPS tiers)
**Versions vérifiées au code (2026-10-28) :** `socle-pack-egress` **3.0.0** (`main`, tag `v3.0.0`, commit `aa521dc`) — Spring Boot 4.1.2, socle V005 ≥ **5.10.0**, gRPC 1.85.1 / protobuf 4.36.2 · socle 5.8.4 → 5.9.x : **2.0.0** (commit `36be667`) · Hub `soclehub` **3.73.0** (tunnel gRPC depuis 3.48.1, vhost `egress.thesocle.net` depuis 3.48.2)
**App en Spring Boot 3 / socle 5.7.x :** rester en `socle-pack-egress` **1.0.0** (dernière version Boot 3, commit `8c8544e`) — c'est le cas des consommateurs réels, en 5.7.4
**Prérequis :** une clé API IAM du Hub `.net` dont le propriétaire est membre du tenant `lmvi`
**Temps estimé :** 20 min

> Côté plateforme : `soclehub/docs/HOWTO-SORTIR-PAR-LES-MMH.md` (proxy `soclehub:3128`, même moteur de sélection)
> Suite : [[howto-egress-02-faire-sortir-un-client-http|EGRESS-02]] · [[howto-egress-03-choisir-sa-sortie|EGRESS-03]]

---

## 1. Contexte

Une application qui interroge un service tiers sort par l'IP de sa machine. Sur un minihub posé
à la maison, plusieurs applications partagent alors **la même IP** et donc le même quota : c'est
ce qui a valu à KEW ~14 000 refus `429` Wikidata par 24 h (mesuré le 2026-09-26, trois machines
derrière `82.67.1.235`).

Le Hub sait faire sortir un flux par un **mmh** (miniMiniHub) de rôle `proxy`, sur une IP choisie.
Sur le réseau Docker du Hub, une app déclare simplement le proxy `soclehub:3128`. Une app d'un
**minihub** ne joint pas ce proxy : elle embarque `socle-pack-egress`, qui transporte les
connexions jusqu'au Hub par un tunnel gRPC public et authentifié.

Le pack ne fait **rien** tant que `socle.egress-client.enabled` vaut `false` (défaut) :
l'application sort alors par sa propre IP, exactement comme avant.

---

## 2. Architecture

```
┌──────────────────────── application (minihub) ───────────────────────┐
│ OkHttp / HttpClient ──CONNECT www.wikidata.org:443──► 127.0.0.1:<port>│
│                                         EgressTunnelProxy (bean)     │
│                                         └ EgressTunnelSession / conn │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ gRPC EgressTunnel.Open (bidi)
                                │ TLS + ALPN h2, métadonnée x-api-key
                                ▼
┌──────────────── Hub .net — egress.thesocle.net:443 ──────────────────┐
│ EgressTunnelAuthInterceptor → clé IAM → Caller (email, tenant)       │
│ EgressTunnelGrpcService → EgressProxyServer.openForClient            │
│   tenant lmvi ? port autorisé ? sortie ? host-limits ? 64/clé ?      │
│   journal egress.tr_egress_session                                   │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼ gRPC minihub
                   minihub-ovh-rss ──► mmh-prod-001 ──► internet
                                       IP 152.228.141.0
                    (TLS du site de bout en bout : ni le pack ni le Hub ne voient le contenu)
```

---

## 3. Étape 1 — Obtenir la clé IAM (côté Hub)

Le pack s'authentifie par une **clé API IAM** du Hub `.net`, envoyée en métadonnée gRPC
`x-api-key`. Le Hub refuse toute clé dont le propriétaire n'est pas dans un tenant autorisé
(`socle.egress.proxy.allowed-tenants`, défaut `lmvi`).

Créer la clé par MCP (`iam_worker__create_api_key`) :

```json
{ "user_id": "2", "key_name": "kew-mini001-egress", "expires_in_days": 365 }
```

La ranger au Vault de l'application, jamais dans le dépôt. KEW range une clé **par machine**
sous `soclehub/kew/egress` (clés `mini001`, `spark`, `mini-m4`).

> Le nom d'hôte `egress.thesocle.net` pointe le Hub `.net` (`51.178.79.192`). Il n'existe pas
> d'`egress.thesocle.io` au 2026-10-28 : la clé est une clé IAM **du Hub `.net`**, même pour une
> app rattachée à `.io`.

---

## 4. Étape 2 — Ajouter la dépendance

```xml
<dependency>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-pack-egress</artifactId>
    <version>3.0.0</version>   <!-- socle ≥ 5.10.0 / Boot 4.1 ; 2.0.0 pour 5.8.4 → 5.9.x ; 1.0.0 pour 5.7.x / Boot 3 -->
</dependency>
```

gRPC et protobuf sont en portée `provided` : le pack s'appuie sur ceux du socle V005, transport
`grpc-netty-shaded` compris. Rien d'autre à déclarer — **et surtout pas de version gRPC propre à l'app** :
le pack 3.0.0 est compilé avec le gRPC du socle (1.85.1 / protobuf 4.36.2), une seconde version
sur le classpath ne ferait que créer l'écart que l'alignement évite. Le pack n'embarque pas non plus
d'OkHttp : en socle 5.10, c'est `com.squareup.okhttp3:okhttp-jvm` 5.5.1, fourni par le socle.

> ⚠️ **gRPC réellement résolu dans une app en socle 5.10.0 : 1.84.1.** Le parent Boot 4.1.2 importe
> `grpc-bom` à `${grpc-java.version}` = 1.84.1 et le pom du socle 5.10.0 ne surcharge pas cette
> propriété : tous les `io.grpc:*` de l'app tombent en 1.84.1 (relevé le 2026-10-28 avec
> `mvn dependency:list` sur une app minimale). Le tunnel du pack passe ses tests sur ce runtime-là
> aussi. Pour avoir le gRPC annoncé par le socle, l'app pose
> `<grpc-java.version>1.85.1</grpc-java.version>` dans ses `<properties>` — c'est la **seule** déclaration
> gRPC admise, car elle aligne tout le BOM au lieu d'ajouter une seconde version.

**Rendre l'artefact disponible au build.** Le pack se construit depuis son dépôt :

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-egress
mvn clean install          # 17 tests réels : tunnel (serveur gRPC Netty + sockets), auto-configuration Boot 4.1
                           # et noms de beans, alignement gRPC/protobuf sur le socle, manifeste — ~10 s
mvn verify -Dsocle.version=5.9.0   # échoue, comme attendu : 5.9.x = gRPC 1.81 / protobuf 3.25 → pack 2.0.0
```

Pour qu'un clone frais ou une CI compile, vendoriser le `.jar` et le `.pom` dans le `mvn-repo/`
de l'application, comme le framework :

```bash
APP=/opt/2026-TheHub4TheSocle/APP-09-KEW
V=3.0.0   # 2.0.0 pour un socle 5.8.4 → 5.9.x ; 1.0.0 pour une app restée en Boot 3
mkdir -p $APP/mvn-repo/eu/lmvi/socle-pack-egress/$V
cp ~/.m2/repository/eu/lmvi/socle-pack-egress/$V/socle-pack-egress-$V.{jar,pom} \
   $APP/mvn-repo/eu/lmvi/socle-pack-egress/$V/
```

```xml
<repositories>
    <repository>
        <id>project-local</id>
        <url>file://${project.basedir}/mvn-repo</url>
        <releases><enabled>true</enabled></releases>
    </repository>
</repositories>
```

---

## 5. Étape 3 — Configurer

Propriétés `socle.egress-client.*` (classe `EgressClientProperties`) :

| Propriété | Défaut | Rôle |
|---|---|---|
| `enabled` | `false` | crée le bean `EgressTunnelProxy` ; sans lui, aucun bean |
| `endpoint` | `egress.thesocle.net:443` | entrée gRPC du Hub, `hôte:port` |
| `api-key` | `""` | clé IAM, envoyée en `x-api-key` |
| `selector` | `pool` | sortie voulue (voir [[howto-egress-03-choisir-sa-sortie\|EGRESS-03]]) |
| `affinity` | `""` | jeton d'affinité (même sortie pendant le TTL du Hub, 10 min) |
| `local-port` | `0` | port d'écoute sur `127.0.0.1` ; `0` = port libre tiré au démarrage |
| `ack-timeout-ms` | `15000` | attente de la réponse du Hub à l'ouverture (→ `504`) |
| `idle-timeout-ms` | `600000` | fermeture d'une sortie sans aucun octet |
| `plaintext` | `false` | gRPC sans TLS — tests uniquement |

`application.yml`, sur le modèle de KEW (variables propres à l'app) :

```yaml
socle:
  egress-client:
    enabled: ${KEW_EGRESS_ENABLED:false}
    endpoint: ${KEW_EGRESS_ENDPOINT:egress.thesocle.net:443}
    api-key: ${KEW_EGRESS_API_KEY:}
    selector: ${KEW_EGRESS_SELECTOR:pool}
```

Le `docker-compose` de la machine transmet les variables (`APP-09-KEW/deploy/compose-mini001.yml`) :

```yaml
    environment:
      KEW_EGRESS_ENABLED: "${KEW_EGRESS_ENABLED:-false}"
      KEW_EGRESS_ENDPOINT: "${KEW_EGRESS_ENDPOINT:-egress.thesocle.net:443}"
      KEW_EGRESS_API_KEY: "${KEW_EGRESS_API_KEY:-}"
      KEW_EGRESS_SELECTOR: "${KEW_EGRESS_SELECTOR:-pool}"
```

Sans placeholder dans le YAML, la liaison souple de Spring Boot lit directement les variables
annoncées par `META-INF/socle-pack.json` : `SOCLE_EGRESSCLIENT_ENABLED`, `SOCLE_EGRESSCLIENT_ENDPOINT`,
`SOCLE_EGRESSCLIENT_APIKEY`, `SOCLE_EGRESSCLIENT_SELECTOR`, `SOCLE_EGRESSCLIENT_AFFINITY`,
`SOCLE_EGRESSCLIENT_LOCALPORT`, `SOCLE_EGRESSCLIENT_ACKTIMEOUTMS`, `SOCLE_EGRESSCLIENT_IDLETIMEOUTMS`,
`SOCLE_EGRESSCLIENT_PLAINTEXT` (`LOCALPORT` et `PLAINTEXT` figurent au manifeste depuis 2.0.0 ; en 1.0.0
ils étaient liés sans y être déclarés).

---

## 6. Étape 4 — Démarrer

L'auto-configuration `EgressClientAutoConfiguration` (déclarée dans
`META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`) :

1. valide `endpoint` (`hôte:port`) et `api-key` (non vide) — sinon **le contexte Spring échoue** ;
2. ouvre le canal gRPC (TLS, keep-alive 60 s, user-agent `socle-pack-egress/3.0.0`) ;
3. lie le `ServerSocket` sur `127.0.0.1:<local-port>` et lance la boucle d'acceptation sur un
   thread virtuel ;
4. enregistre `close()` comme méthode de destruction : à l'arrêt, `channel.shutdownNow()` annule
   tous les flux et le Hub libère les sorties.

Log attendu :

```
[egress-client] proxy local 127.0.0.1:41955 → egress.thesocle.net:443 (sélecteur « mmh-prod-001 »)
```

Le bean seul ne change rien au trafic : il faut encore **donner le proxy au client HTTP**
([[howto-egress-02-faire-sortir-un-client-http|EGRESS-02]]).

---

## 7. Vérifier

```bash
# depuis la machine de l'app : le proxy local répond-il ?
docker logs kew-worker 2>&1 | grep 'egress-client' | tail -2

# test bout en bout contre la prod, depuis le dépôt du pack
cd /opt/2026-TheHub4TheSocle/socle-pack-egress
EGRESS_LIVE_KEY=<clé> EGRESS_LIVE_SELECTOR=mmh-prod-001 mvn test -Dtest=EgressLiveIT
```

`EgressLiveIT` fait cinq appels HTTPS à Wikidata par le tunnel et vérifie `last_exit`. Relevé du
2026-09-26 : 1 224 ms pour le premier appel (ouverture du tunnel), puis 193 à 423 ms sur la
connexion gardée ; `last_exit=mmh-prod-001`, `last_exit_ip=152.228.141.0`.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `enabled: false` | aucun bean `EgressTunnelProxy` ; l'app démarre et sort en direct |
| 2 | `enabled: true`, `api-key` vide | démarrage refusé : « socle.egress-client.api-key est vide : le Hub refuserait toute sortie (407) » |
| 3 | `enabled: true`, `endpoint: egress.thesocle.net` (sans port) | démarrage refusé : « attendu hôte:port » |
| 4 | clé valide, sélecteur `mmh-prod-001` | log `[egress-client] proxy local …` puis `stats().last_exit_ip = 152.228.141.0` au premier appel |
| 5 | `mvn verify` dans le pack (3.0.0) | 17 tests, 0 échec, 0 sauté : `EgressTunnelProxyTest` 6, `EgressClientAutoConfigurationTest` 5, `GrpcAlignementSocleTest` 3, `SoclePackManifestTest` 3 (relevé le 2026-10-28, socle 5.10.0) ; `EgressLiveIT` hors suite (clé IAM requise) |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `enabled: true` sans clé | l'app ne démarre pas (`IllegalArgumentException` à la création du bean) | garder `enabled: false` tant que la clé n'est pas au Vault — c'est le choix de RssArchiver |
| Clé d'un compte hors tenant `lmvi` | chaque connexion reçoit `403 tenant … non autorisé` | compte de service membre de `lmvi` sur `.net` |
| Clé IAM `.io` | `407` : `egress.thesocle.net` est le Hub `.net` | clé IAM du Hub `.net` |
| Pack absent de `maven.thesocle.net` | `Could not find artifact eu.lmvi:socle-pack-egress:jar:3.0.0` (ou `2.0.0`, `1.0.0`) sur une autre machine | `mvn install` depuis le dépôt du pack, puis vendoriser dans `mvn-repo/` (KEW et RssArchiver dépendent aujourd'hui du `~/.m2` de la box de build) |
| `endpoint` vers `soclehub:80` ou `:80` | flux en échec : le gRPC du Hub n'écoute pas en h2c | `egress.thesocle.net:443`, TLS + ALPN h2 |
| Embarquer aussi `grpc-contracts` | conflit de classes redouté | aucun : le pack génère ses classes sous `eu.lmvi.socle.pack.egress.proto` |
| App du réseau Docker du Hub | pack inutile, un saut de plus | proxy `soclehub:3128` (HOWTO Hub) |
| Pack 2.0.0 dans une app en socle 5.7.x / Boot 3 | classes générées par grpc-java 1.81 sur un gRPC 1.60 (erreurs de liaison à l'exécution), auto-configuration bâtie pour Boot 4 | rester en **1.0.0** jusqu'à la montée de socle de l'app ; passer en 2.0.0 en même temps que le socle ≥ 5.8.4 |
| Pack 1.0.0 dans une app en socle ≥ 5.8.4 (Boot 4) | combinaison jamais éprouvée (pack compilé en gRPC 1.60 / Boot 3.2.1) | pack **2.0.0** (corrigé : gRPC aligné sur le socle, auto-configuration testée en Boot 4) |
| Pack 3.0.0 dans une app en socle 5.8.4 → 5.9.x | au chargement des classes `eu.lmvi.socle.pack.egress.proto` : `NoClassDefFoundError` (`com.google.protobuf.RuntimeVersion`, `GeneratedFile`) — le code généré par protobuf 4.36.2 exige protobuf-java ≥ 4.36.2 | rester en **2.0.0** ; passer en 3.0.0 en même temps que le socle 5.10 |
| Pack 2.0.0 gardé après la montée en socle 5.10 | fonctionne (protobuf 4.36.2 garde `GeneratedMessageV3` ; tests tunnel et auto-configuration verts, vérifié le 2026-10-28), mais code généré 3.25 sur un runtime 4.36 et Boot 4.0.6 sous Boot 4.1.2 | filet de transition seulement : prendre **3.0.0** |
| App qui manipule les classes générées (`ClientFrame`, `OpenRequest`…) | en 3.0.0 : `GeneratedMessageV3` → `GeneratedMessage`, plus de `Builder.clone()`/`setField()` covariants | n'utiliser que `EgressTunnelProxy` ; le package `…egress.proto` est interne au pack |
| App qui déclare sa propre version de gRPC | deux gRPC sur le classpath, ou un gRPC différent de celui pour lequel le pack est compilé | ne déclarer aucune dépendance `io.grpc` ; au plus `<grpc-java.version>1.85.1</grpc-java.version>` (aligne le BOM de Boot 4.1.2, qui imposerait sinon 1.84.1 à tout gRPC) |
| Un second OkHttp | deux copies de `okhttp3.*` (socle 5.10 = `okhttp-jvm` 5.5.1, l'ancien artefact `okhttp` 4.12) | ne pas déclarer `com.squareup.okhttp3:okhttp` ; le pack n'en embarque aucun |
| Première mise en service en socle 5.10 | le tunnel est prouvé par les tests (vrai serveur gRPC 1.85.1, et runtime 1.84.1), pas encore contre le Hub réel avec la 3.0.0 | faire passer `EgressLiveIT` (clé IAM requise) avant la mise en service |

---

## 10. Pour aller plus loin

- [[howto-egress-02-faire-sortir-un-client-http|EGRESS-02 — Faire sortir un client HTTP]]
- [[howto-egress-03-choisir-sa-sortie|EGRESS-03 — Choisir sa sortie]]
- [[howto-egress-04-observer-et-diagnostiquer|EGRESS-04 — Observer et diagnostiquer]]
- [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28 — Intégrer un socle-pack dans une app]]
- [[howto-32-enroler-un-minihub|HOWTO 32 — Enrôler un minihub]] · [[howto-33-installer-une-app-sur-minihub|HOWTO 33 — Installer une app sur un minihub]]
- Contrat : `socle-pack-egress/src/main/proto/egress_tunnel.proto` (copie de `grpc-contracts`, source de vérité)
