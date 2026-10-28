# socle-pack-egress — sortir sur internet par un mmh du Hub

> **Version documentée :** `eu.lmvi:socle-pack-egress:2.0.0` — dépôt `/opt/2026-TheHub4TheSocle/socle-pack-egress`,
> branche `feat/boot4` (non fusionnée dans `main` au 2026-10-28), commit `36be667` — **Spring Boot 4.0.6,
> socle 5.9.0** (minimum 5.8.4), gRPC 1.81.0 / protobuf 3.25.9 alignés sur le socle.
> **Dernière version Boot 3 = 1.0.0** (`main`, commit `8c8544e`, Spring Boot 3.2.1, gRPC 1.60, socle 5.7.x) :
> c'est celle qu'utilisent encore les consommateurs en socle 5.7.4.
> **Côté Hub, lu au code :** `soclehub` 3.73.0 (commit `35fdcd0`). **Vérifié le :** 2026-10-28.

## Le pack en 5 lignes

1. Il ouvre dans l'application un **proxy HTTP local** sur `127.0.0.1` (bean `EgressTunnelProxy`).
2. Chaque `CONNECT hôte:port` reçu devient un flux gRPC `EgressTunnel.Open` vers le Hub (`egress.thesocle.net:443`, TLS + ALPN h2).
3. Le Hub choisit la sortie désignée par le **sélecteur** (`pool`, `pool-FR`, `mmh-prod-001`, `+tor`, `~affinité`) et relaie les octets par ce **mmh** : le site voit l'IP du mmh, le TLS reste de bout en bout.
4. Il sert aux apps qui **ne joignent pas** `soclehub:3128` — celles des minihubs (KEW sur mini001, spark, mini-m4, nas4). Une app du réseau Docker du Hub se contente du proxy `soclehub:3128`, sans pack.
5. Aucun worker, aucune table, aucune action MCP : une auto-configuration conditionnelle (`socle.egress-client.enabled=true`), un bean, des compteurs en mémoire.

## Besoin → howto

| Besoin | Howto |
|---|---|
| Ajouter le pack, la clé IAM, la configuration, et démarrer | [[howto-egress-01-integrer-le-pack\|01 — Intégrer le pack]] |
| Faire passer un client HTTP (OkHttp, `java.net.http`, composant configuré par URL) par la sortie | [[howto-egress-02-faire-sortir-un-client-http\|02 — Faire sortir un client HTTP]] |
| Choisir une IP fixe, un pays, une rotation, une affinité ; lister et tester les sorties côté Hub | [[howto-egress-03-choisir-sa-sortie\|03 — Choisir sa sortie]] |
| Lire les compteurs, comprendre un refus (403/407/429/502/503/504/405), diagnostiquer | [[howto-egress-04-observer-et-diagnostiquer\|04 — Observer et diagnostiquer]] |

## Ce que fait le pack, ce qui reste au Hub

| Côté app (le pack) | Côté Hub (`soclehub`) |
|---|---|
| Proxy local `127.0.0.1`, lecture du `CONNECT`, réponse `405` au trafic en clair | Authentification de la clé (`x-api-key`) — `EgressTunnelAuthInterceptor` |
| Flux gRPC par connexion, contrôle de flux, fermeture des deux sens ensemble | Garde-fous : tenant `lmvi`, ports `80,443,465,587,993,995`, 64 tunnels par clé, `host-limits` — `EgressProxyServer.openForClient` |
| Remontée du code de refus du Hub au client HTTP, `504` si pas d'ack | Choix de la sortie (sélecteur, affinité, moins chargée), journal `egress.tr_egress_session` |
| Compteurs `stats()` sans appel réseau | Pool et sondes : `egress_pool`, `egress_test`, `egress_proxy_status`, `egress_probe_status` |

Les mots de passe de proxy (`egress_proxy_password_create`) servent aux **navigateurs** sur `soclehub:3128`.
Le tunnel gRPC qu'emploie le pack accepte une clé API IAM ou un JWT Bearer — le pack n'envoie que la clé API.

## Dépendances

| Dépendance | Portée | Fournie par |
|---|---|---|
| `io.grpc:grpc-api`, `grpc-stub`, `grpc-protobuf` (**1.81.0**, la version du socle) | `provided` | le socle V005 de l'app |
| `com.google.protobuf:protobuf-java` (**3.25.9**, la version du socle) | `provided` | le socle |
| un transport gRPC à l'exécution (`grpc-netty-shaded`) | — | le socle (5.8.0 → 5.9.5 : gRPC 1.81.0) |
| `spring-boot-autoconfigure`, `slf4j-api` | `provided` | l'app |

Le pack **ne dépend pas** de `socle-v005` (il n'en utilise aucune classe) : `<socle.version>5.9.0</socle.version>`
ne sert qu'au test `GrpcAlignementSocleTest`, qui lit le pom embarqué dans le jar du socle et échoue si le gRPC
ou le protobuf du pack divergent de ceux du socle (passe en 5.9.0 et 5.8.8, échoue en 5.7.4).

`socle-pack.json` (2.0.0) : `minSocleVersion` **5.8.4**, `springBootVersion` 4.0.6, `grpcVersion` 1.81.0,
`protobufVersion` 3.25.9, aucun pack requis. Parent Maven du pack : Spring Boot **4.0.6**.

| Pack | Boot | Socle | gRPC / protobuf |
|---|---|---|---|
| **2.0.0** | 4.0.6 | ≥ 5.8.4 (testé 5.9.0 et 5.8.8) | 1.81.0 / 3.25.9 |
| 1.0.0 — dernière Boot 3 | 3.2.1 | 5.7.x | 1.60.0 / 3.25.1 |

## Apps consommatrices (2026-10-28)

| App | Socle | Usage |
|---|---|---|
| `APP-09-KEW` 1.8.0 | 5.7.4 → pack **1.0.0** | `WikidataGatewayWorker` : OkHttp branché sur `EgressTunnelProxy.proxy()`, une sortie fixe par instance (`KEW_EGRESS_SELECTOR`) |
| `APP-12-RssArchiver` | 5.7.4 → pack **1.0.0** | port local fixe `3129`, donné à pack-ai par `socle.ai.web.proxy-url` (pas de code Java) |

Aucune ne passe en 2.0.0 tant qu'elle reste en socle 5.7.x / Boot 3 : la montée du pack suit celle du socle de l'app.

## Écarts relevés entre README et code

Résumés dans chaque howto (section « Pièges courants ») ; la liste complète figure en tête de
[[howto-egress-04-observer-et-diagnostiquer|04]].
