# socle-pack-egress — sortir sur internet par un mmh du Hub

> **Version documentée :** `eu.lmvi:socle-pack-egress:1.0.0` — dépôt `/opt/2026-TheHub4TheSocle/socle-pack-egress`,
> branche `main`, commit `8c8544e` (« sortir par un mmh du Hub via le tunnel gRPC »), unique commit du dépôt.
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
| `io.grpc:grpc-api`, `grpc-stub`, `grpc-protobuf` (compilé en 1.60.0) | `provided` | le socle V005 de l'app |
| `com.google.protobuf:protobuf-java` (3.25.1) | `provided` | le socle |
| un transport gRPC à l'exécution (`grpc-netty-shaded`) | — | le socle (présent jusqu'en 5.9.5, gRPC 1.81.0) |
| `spring-boot-autoconfigure`, `slf4j-api` | `provided` | l'app |

`socle-pack.json` : `minSocleVersion` **5.7.0**, aucun pack requis. Parent Maven du pack : Spring Boot **3.2.1**.

## Apps consommatrices (2026-10-28)

| App | Socle | Usage |
|---|---|---|
| `APP-09-KEW` 1.8.0 | 5.7.4 | `WikidataGatewayWorker` : OkHttp branché sur `EgressTunnelProxy.proxy()`, une sortie fixe par instance (`KEW_EGRESS_SELECTOR`) |
| `APP-12-RssArchiver` | 5.7.4 | port local fixe `3129`, donné à pack-ai par `socle.ai.web.proxy-url` (pas de code Java) |

## Écarts relevés entre README et code

Résumés dans chaque howto (section « Pièges courants ») ; la liste complète figure en tête de
[[howto-egress-04-observer-et-diagnostiquer|04]].
