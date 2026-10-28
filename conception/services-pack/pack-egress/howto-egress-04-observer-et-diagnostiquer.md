# HOWTO EGRESS-04 — Observer la sortie et diagnostiquer un refus

**Niveau :** Confirmé
**Cible :** exploitant ou développeur d'une app qui sort par `socle-pack-egress`
**Versions vérifiées au code (2026-10-28) :** `socle-pack-egress` **3.0.0** (commit `aa521dc`) — comportement identique à la 2.0.0 et à la 1.0.0 (`EgressStats`, `EgressTunnelSession`, `ConnectHead`) · Hub `soclehub` **3.73.0** (`EgressProxyServer.openForClient`)
**Temps estimé :** 15 min

---

## 1. Contexte

Le pack n'expose ni worker, ni action MCP, ni table : son état tient dans des **compteurs en
mémoire**, lus par `EgressTunnelProxy.stats()` sans aucun appel réseau. C'est à l'application de
les publier — typiquement dans le `getStats()` du worker qui emploie la sortie, ce qui les rend
visibles au Status Dashboard et par MCP.

Un refus du Hub arrive au client HTTP **sous la forme d'une réponse au `CONNECT`**, avec le code du
Hub. Le journal complet des tunnels, lui, vit côté Hub (`egress.tr_egress_session`).

---

## 2. Architecture

```
client HTTP ◄── réponse au CONNECT ──┐
  200 Connection established         │   EgressTunnelSession
  4xx/5xx + message texte du Hub     │     ack ok  → stats.opened(exit, ip)
                                     │     ack ko  → stats.refused(code, msg) → même code au client
                                     │     pas d'ack en ack-timeout-ms → stats.failed → 504
                                     │     flux en erreur avant ack → stats.failed → 502
EgressTunnelProxy.stats() ◄──────────┘
        │
        ▼ getStats() du worker → Status Dashboard / MCP
Hub : egress.tr_egress_session (une ligne par tunnel, appelant, destination, octets, erreur)
```

---

## 3. Étape 1 — Publier les compteurs

```java
@Override
public Map<String, Object> getStats() {
    Map<String, Object> stats = new HashMap<>(super.getStats());
    EgressTunnelProxy proxy = egress.getIfAvailable();
    stats.put("egress", proxy == null ? Map.of("enabled", false) : proxy.stats());
    return stats;
}
```

Clés rendues par `stats()` — aucune valeur nulle, la map peut remonter telle quelle dans un
`ActionResult` :

| Clé | Sens |
|---|---|
| `tunnels_active` | connexions locales en cours (y compris celles qui attendent l'ack) |
| `tunnels_opened` | ouvertures acceptées par le Hub |
| `tunnels_refused` | refus du Hub (ack `ok=false`) |
| `refused_by_code` | refus ventilés par code, ex. `{"429": 3}` |
| `tunnels_failed` | pas d'ack dans le délai, ou flux gRPC en erreur avant l'ack |
| `bytes_up` / `bytes_down` | octets app → site / site → app |
| `last_exit` / `last_exit_ip` | slug et IP de la dernière sortie ouverte |
| `last_error` | dernier message d'erreur (refus, délai, inactivité, coupure) |
| `endpoint`, `selector`, `local_port` | rappel de la configuration |

Relevé réel (`EgressLiveIT`, 2026-09-26) :

```
{tunnels_active=1, tunnels_opened=1, tunnels_refused=0, tunnels_failed=0, refused_by_code={},
 bytes_up=1510, bytes_down=16967, last_exit=mmh-prod-001, last_exit_ip=152.228.141.0,
 last_error=, endpoint=egress.thesocle.net:443, selector=mmh-prod-001, local_port=36601}
```

Les compteurs repartent de zéro à chaque démarrage.

---

## 4. Étape 2 — Lire un refus

| Code | Émis par | Cause | Réaction |
|---|---|---|---|
| `405` | pack | requête en clair (pas un `CONNECT`) | passer en `https://` ou utiliser un client direct |
| `400` | pack | `CONNECT` mal formé (pas de `hôte:port`) | corriger l'URL |
| `400` | Hub | hôte vide | idem |
| `407` | Hub | clé absente, fausse, révoquée ou expirée (cache de 1 min côté Hub) | vérifier la clé au Vault ; une clé révoquée cesse au plus tard 1 min après |
| `403` | Hub | tenant non autorisé (`tenant … non autorisé`) ou port hors liste (`port … non autorisé`) | compte du tenant `lmvi` ; ports `80,443,465,587,993,995` |
| `503` | Hub | aucune sortie utilisable pour le sélecteur | `egress_pool` ; se replier sur `pool` |
| `429` | Hub | `64 tunnels simultanés au plus par identité`, ou `débit maximal vers <site> atteint` (`host-limits`) | réduire le pool de connexions ; espacer les appels |
| `502` | Hub ou pack | le Hub n'a pas pu ouvrir la sortie (mini-hub déconnecté), ou le flux gRPC a échoué avant l'ack | réessayer, éventuellement sur une autre sortie |
| `504` | pack | pas d'ack du Hub en `ack-timeout-ms` (15 s) | Hub ou réseau injoignable |
| fermeture juste après `200` | mmh | le mmh n'a pas joint le site (DNS, refus, adresse privée) | l'erreur TLS côté client en est le symptôme ; `last_error` porte le message `closed` du Hub |

Côté **OkHttp**, une réponse non-200 au `CONNECT` ne devient pas une `Response` : l'appel lève une
`IOException` (« Unexpected response code for CONNECT: 429 »), et un `407` passe par le
`proxyAuthenticator`, qui par défaut abandonne (« Failed to authenticate with proxy »). Le
`GatewayWorker` voit donc une erreur d'E/S : son disjoncteur et son retry s'appliquent. Un retry
automatique sur un `429` de quota ou un `407` aggrave le refus ; KEW ne rejoue plus les `429`.

---

## 5. Étape 3 — Lire le journal côté Hub

Chaque tunnel ouvert par la clé de l'app est une ligne de `egress.tr_egress_session` sur le Hub
`.net` (`x_createdBy` = email du propriétaire de la clé, `x_partition` = tenant) :

```sql
SELECT target_host, count(*) AS tunnels, sum(bytes_in) AS octets_recus, max(started_at) AS dernier
FROM egress.tr_egress_session
WHERE x_createdBy = 'jm@henry.sh'
  AND started_at > now() - interval '1 day'
GROUP BY target_host
ORDER BY tunnels DESC;
```

Requête légère, à passer par `postgresql_database__query` du Hub ou l'écran **Proxy**
(`/hub/proxy/sessions` : archives filtrables par appelant et destination, export CSV).

État global du moteur de sortie : `egress_proxy_worker__egress_proxy_status`. Santé mesurée de
chaque sortie : `egress_probe_worker__egress_probe_status` (une sortie qui échoue à la sonde est
retirée du pool même si son heartbeat est frais).

---

## 6. Étape 4 — Tester le pack seul

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-egress
mvn test                                   # EgressTunnelProxyTest : 6 tests, faux Hub gRPC réel
EGRESS_LIVE_KEY=<clé> EGRESS_LIVE_SELECTOR=mmh-prod-001 mvn test -Dtest=EgressLiveIT
```

`HubEgressTestServer` applique le contrat du Hub ; un sélecteur `refuse-<code>` y simule un refus
(`refuse-429` → `HTTP/1.1 429 Too Many Requests`). `EgressLiveIT` est sauté sans `EGRESS_LIVE_KEY`.

---

## 7. Vérifier

```bash
# Le worker publie-t-il l'état de la sortie ? (porte MCP de l'app, clé MCP de l'app)
curl -s -H "Authorization: Bearer $MCP_API_KEY" -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -X POST http://127.0.0.1:8801/mcp \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"status_dashboard_worker__get_all_workers_status","arguments":{}}}'
```

L'invocation d'une action d'une app passe par `POST /mcp` (porte `/api/actions` = Hub seulement) ;
le port MCP de KEW est `MCP_PORT` (8801 par défaut). Chercher le bloc `egress` du worker : `tunnels_opened` > 0, `last_exit_ip` = IP attendue,
`refused_by_code` vide.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Appel HTTPS réussi | `tunnels_opened` +1, `last_exit_ip` renseigné |
| 2 | Clé révoquée (après 1 min) | `refused_by_code["407"]` +1, l'appel lève une `IOException` |
| 3 | Hub injoignable | `tunnels_failed` +1, `504`, `last_error = pas de réponse du Hub en 15000 ms…` |
| 4 | Connexion gardée sans trafic > `idle-timeout-ms` | sortie fermée, `last_error = inactivité > 600000 ms` |
| 5 | Arrêt de l'app | log `[egress-client] proxy local arrêté` ; plus aucune session ouverte côté Hub |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Attendre un `Retry-After` sur un `429` | absent : l'ack gRPC n'a pas de champ de délai, le pack répond sans cet en-tête | temporiser côté app (le `429` d'un **site** atteint par le tunnel, lui, garde son `Retry-After`) |
| Redémarrage du Hub `.net` | `502` sur toutes les ouvertures pendant ~2 min | laisser passer : le canal du mini-hub se reconnecte toutes les 30 s ; ne pas changer de sélecteur dans l'urgence |
| Retry automatique sur `407`/`429` | refus multipliés | exclure ces codes du retry du `GatewayWorker` |
| Lire `tunnels_active` comme « tunnels ouverts au Hub » | il compte aussi les connexions en cours de négociation ou refusées | `tunnels_opened` − sorties fermées : lire le journal Hub |
| Ne pas publier `stats()` | panne invisible, l'app « sort en direct » en apparence | `stats.put("egress", proxy.stats())` dans `getStats()` |
| Worker du Hub `EgressProxyWorker` « stopped » au dashboard | fausse alerte | convention `getStats()` du dashboard ; se fier à `egress_proxy_status` |
| Voir `tor: true` partout dans le pool | fausse alerte | capacité `+tor`, pas un état ; seul l'ack porte un vrai `tor` (le pack ne le publie pas) |

---

## 10. Écarts README ↔ code relevés (1.0.0, revus en 2.0.0 et 3.0.0)

Le code fait foi. Les points 3 et 6 sont corrigés en 2.0.0, le point 5 en 3.0.0 ; les autres demeurent (hors périmètre des montées de plateforme).

1. **Codes de refus** : le README cite 403/407/429/502/503/504 ; le code produit aussi `400` (pack : `CONNECT` mal formé ; Hub : hôte vide) et `405` (clair).
2. **`429` et `Retry-After`** : le README renvoie au comportement du Hub ; par le pack, aucun `Retry-After` n'est transmis.
3. ~~**Manifeste `socle-pack.json`** : `local-port` et `plaintext` n'y figurent pas~~ — **corrigé en 2.0.0** : `SOCLE_EGRESSCLIENT_LOCALPORT` et `SOCLE_EGRESSCLIENT_PLAINTEXT` y sont déclarés.
4. **Champ `tor` de l'ack** : reçu mais ni mémorisé ni exposé par `stats()`.
5. ~~**User-agent** : écrit en dur dans `EgressTunnelProxy`, indépendant de la version du pom~~ — **corrigé en 3.0.0** : constante `EgressTunnelProxy.USER_AGENT` (`socle-pack-egress/3.0.0`), comparée à la version du pom par `SoclePackManifestTest`.
6. ~~**Compatibilité** : le README annonce une compatibilité gRPC « avec les versions suivantes », jamais prouvée au-delà du socle 5.7.4~~ — **corrigé en 2.0.0** : le pack est compilé avec le gRPC du socle (1.81.0 / protobuf 3.25.9), alignement vérifié par `GrpcAlignementSocleTest` (5.9.0 et 5.8.8 passent, 5.7.4 échoue) ; la 1.0.0 reste la version des socles 5.7.x. En 3.0.0 : gRPC 1.85.1 / protobuf 4.36.2 (socle 5.10.0), 5.9.0 échoue comme attendu. Reste à faire : `EgressLiveIT` contre le Hub réel avec la 3.0.0.
7. **Authentification** : le Hub accepte sur ce tunnel un JWT Bearer ou une clé API ; le pack n'envoie que la clé. Les mots de passe de proxy (`egress_proxy_password_create`) ne s'appliquent qu'au proxy `soclehub:3128`.
8. **Distribution** : le README montre la dépendance Maven sans dire d'où vient l'artefact ; il n'est pas publié sur `maven.thesocle.net` (fiche mémoire du pack, commentaire du `pom.xml` de RssArchiver) — `mvn install` depuis le dépôt.
9. **Plusieurs sorties** : une seule politique (`selector`) par bean ; l'auto-configuration n'a pas de `@ConditionalOnMissingBean`.

---

## 11. Pour aller plus loin

- [[howto-egress-01-integrer-le-pack|EGRESS-01 — Intégrer le pack]]
- [[howto-egress-02-faire-sortir-un-client-http|EGRESS-02 — Faire sortir un client HTTP]]
- [[howto-egress-03-choisir-sa-sortie|EGRESS-03 — Choisir sa sortie]]
- `soclehub/docs/HOWTO-SORTIR-PAR-LES-MMH.md` §5 (codes), §7 (exploitation, journal, réglages du Hub)
