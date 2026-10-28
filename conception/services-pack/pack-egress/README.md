# socle-pack-egress — sortir sur internet par un mmh du Hub

> **Version documentée :** `eu.lmvi:socle-pack-egress:3.1.0` — dépôt `/opt/2026-TheHub4TheSocle/socle-pack-egress`,
> branche `main`, tag `v3.1.0`, commit `b279f6d` — **Spring Boot 4.1.2, construit contre le socle 5.11.0**
> (minimum 5.10.0), gRPC 1.85.1 / protobuf 4.36.2 alignés sur le socle. Comportement identique à la 3.0.0
> (`aa521dc`) : seul le build change (parent `eu.lmvi:socle-v005-parent` 5.11.0).
>
> | Pack | Spring Boot | socle-v005 | gRPC / protobuf |
> |---|---|---|---|
> | **3.1.0** | 4.1.2 | 5.10.0 → 5.11.x (construit contre 5.11.0) | 1.85.1 / 4.36.2 |
> | 3.0.0 (tag `v3.0.0`, commit `aa521dc`) | 4.1.2 | 5.10.0 et suivants | 1.85.1 / 4.36.2 |
> | 2.0.0 (tag `v2.0.0`, commit `36be667`) | 4.0.6 | 5.8.4 → 5.9.x | 1.81.0 / 3.25.9 |
> | 1.0.0 | 3.2.1 | 5.7.x | 1.60.0 / 3.25.1 |
>
> 3.1.0 et 3.0.0 forment la lignée « Socle 5.10-5.11 · Boot 4.1.2 » : la 3.0.0 reste valide.
> 3.0.0 est une **majeure** : protobuf 4 change les classes générées publiques
> (`eu.lmvi.socle.pack.egress.proto`) et le code généré refuse un protobuf-java < 4.36.2 — la lignée 3.x ne se
> charge pas sur un socle ≤ 5.9. L'API du pack (`EgressTunnelProxy`, `socle.egress-client.*`) est inchangée.
> **Dernière version Boot 3 = 1.0.0** (`main`, commit `8c8544e`, Spring Boot 3.2.1, gRPC 1.60, socle 5.7.x) :
> c'est celle qu'utilisent encore les consommateurs en socle 5.7.4.
> **Côté Hub, lu au code :** `soclehub` 3.73.0 (commit `35fdcd0`). **Vérifié le :** 2026-10-28.

## Le pack en 5 lignes

1. Il ouvre dans l'application un **proxy HTTP local** sur `127.0.0.1` (bean `EgressTunnelProxy`).
2. Chaque `CONNECT hôte:port` reçu devient un flux gRPC `EgressTunnel.Open` vers le Hub (`egress.thesocle.net:443`, TLS + ALPN h2).
3. Le Hub choisit la sortie désignée par le **sélecteur** (`pool`, `pool-FR`, `mmh-prod-001`, `+tor`, `~affinité`) et relaie les octets par ce **mmh** : le site voit l'IP du mmh, le TLS reste de bout en bout.
4. Il sert aux apps qui **ne joignent pas** `soclehub:3128` — celles des minihubs (KEW sur mini001, spark, mini-m4, nas4). Une app du réseau Docker du Hub se contente du proxy `soclehub:3128`, sans pack.
5. Aucun worker, aucune table, aucune action MCP : une auto-configuration conditionnelle (`socle.egress-client.enabled=true`), un bean (`egressTunnelProxy`, préfixé `egress` selon la convention des packs), des compteurs en mémoire.

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
| `io.grpc:grpc-api`, `grpc-stub`, `grpc-protobuf` (**1.85.1**, la version du socle 5.10.0 et 5.11.0) | `provided` | le socle V005 de l'app |
| `com.google.protobuf:protobuf-java` (**4.36.2**, la version du socle 5.10.0 et 5.11.0) | `provided` | le socle |
| un transport gRPC à l'exécution (`grpc-netty-shaded`) | — | le socle (1.85.1 dans une app au parent `socle-v005-parent` ou qui importe `socle-v005-bom` ≥ 5.10.1 ; 1.84.1 dans une app en socle 5.10.0 sans BOM — voir plus bas) |
| `spring-boot-autoconfigure`, `slf4j-api` | `provided` | l'app |
| OkHttp | — (aucune) | le socle (5.10 : `okhttp-jvm` 5.5.1), si l'app s'en sert |

Le pack **ne dépend pas** de `socle-v005` (il n'en utilise aucune classe ; son jar n'est présent qu'en
portée `test`, sans transitifs). Depuis 3.1.0, le parent Maven du pack est **`eu.lmvi:socle-v005-parent` 5.11.0**
(fils de `spring-boot-starter-parent` 4.1.2) : il fournit `${socle.version}` (5.11.0) et `${socle.grpc.version}`
(1.85.1, d'où `grpc.version`), importe `socle-v005-bom` — dont le `grpc-bom` 1.85.1 bat le `grpc-bom` 1.84.1
importé par Boot — et porte la règle enforcer `socle-versions-testees`. Les surcharges locales
`<socle.version>`, `<grpc-java.version>` et `<protobuf-java.version>` de la 3.0.0 sont retirées (Boot 4.1.2 gère
déjà protobuf-java en 4.36.2) ; `lesTestsTournentSurLeGrpcDuSocle` vérifie un gRPC homogène 1.85.1.
`GrpcAlignementSocleTest` lit le pom embarqué dans le jar du socle et échoue si le gRPC ou le protobuf du pack
divergent de ceux du socle (passe en 5.10.0 et 5.11.0, échoue en 5.9.0).

Côté application, le défaut « une app en socle 5.10.0 reçoit tout gRPC en 1.84.1 » est corrigé par le socle :
`socle-v005-bom` ≥ 5.10.1 importe `grpc-bom` 1.85.1, et le parent `socle-v005-parent` 5.11.0 en hérite. Il reste
vrai pour une app en socle 5.10.0 qui n'importe pas le BOM (voir [[howto-egress-01-integrer-le-pack|EGRESS-01]]).

`socle-pack.json` (3.1.0) : `minSocleVersion` **5.10.0**, `builtAgainstSocleVersion` **5.11.0** (champ nouveau en
3.1.0), `springBootVersion` 4.1.2, `grpcVersion` 1.85.1, `protobufVersion` 4.36.2, `beans` `["egressTunnelProxy"]`,
aucun pack requis — comparé au pom par `SoclePackManifestTest` (la version de Boot se lit dans la propriété
`pack.boot.version`, `project.parent.version` valant désormais 5.11.0). User-Agent gRPC : `socle-pack-egress/3.1.0`.
Tests : 17 verts, 0 sauté ; `EgressLiveIT` hors suite, faute de clé — aucun test contre le Hub réel n'a été fait
avec la 3.x.

| Pack | Boot | Socle | gRPC / protobuf |
|---|---|---|---|
| **3.1.0** | 4.1.2 | 5.10.0 → 5.11.x (construit contre 5.11.0, parent `socle-v005-parent`) | 1.85.1 / 4.36.2 |
| 3.0.0 | 4.1.2 | ≥ 5.10.0 (parent Boot direct) | 1.85.1 / 4.36.2 |
| 2.0.0 | 4.0.6 | 5.8.4 → 5.9.x (testé 5.9.0 et 5.8.8) | 1.81.0 / 3.25.9 |
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
