# HOWTO EGRESS-02 — Faire sortir un client HTTP par le proxy du pack

**Niveau :** Confirmé
**Cible :** Worker ou service d'une app qui a intégré `socle-pack-egress` ([[howto-egress-01-integrer-le-pack|EGRESS-01]])
**Versions vérifiées au code (2026-10-28) :** `socle-pack-egress` **3.1.0** (tag `v3.1.0`, commit `b279f6d`, Boot 4.1.2 / socle 5.11.0, minimum 5.10.0 ; comportement identique à la 3.0.0 `aa521dc`, à la 2.0.0 et à la 1.0.0) · KEW **1.8.0** · RssArchiver (socle 5.7.4)
**Temps estimé :** 15 min

---

## 1. Contexte

Le bean `EgressTunnelProxy` est un proxy HTTP ordinaire, sans authentification, lié à la boucle
locale. L'application le **donne** au client HTTP qui doit sortir par un mmh ; les autres clients
(Hub, base, NATS, APIM) restent en direct. Il n'y a donc ni `NO_PROXY` ni proxy global à poser :
seuls les clients qui reçoivent `proxy()` passent par la sortie.

Trois façons de le brancher, selon le client :

| Client | Branchement | Exemple réel |
|---|---|---|
| OkHttp | `builder.proxy(egress.proxy())` | `APP-09-KEW` — `WikidataGatewayWorker` |
| `java.net.http.HttpClient` | `ProxySelector.of(address)` | `EgressLiveIT` du pack |
| composant configuré par URL | `local-port` fixe + `http://127.0.0.1:<port>` | `APP-12-RssArchiver` — `socle.ai.web.proxy-url` (pack-ai) |

Le pack ne relaie que `CONNECT`, donc **HTTPS** (et tout protocole TLS sur un port autorisé par le
Hub). Une requête en clair envoyée au proxy reçoit `405` et ne part jamais par l'IP de la machine.

---

## 2. Architecture

```
GatewayWorker ── OkHttpClient(proxy = 127.0.0.1:41955) ──► EgressTunnelProxy
                                                             │ 1 connexion TCP locale
                                                             │ = 1 flux gRPC = 1 tunnel Hub
Autres clients (Hub, PG, NATS) ── direct ──────────────────► réseau local / Hub
```

Une connexion gardée vivante par le pool du client HTTP reste **un tunnel ouvert** : elle compte
dans les 64 tunnels simultanés autorisés par clé côté Hub.

---

## 3. Étape 1 — OkHttp dans un GatewayWorker (modèle KEW)

Injecter `ObjectProvider<EgressTunnelProxy>` : le bean n'existe que si `enabled=true`, et le
worker garde la sortie directe sinon.

```java
package eu.lmvi.kew.service;

import eu.lmvi.socle.pack.egress.EgressTunnelProxy;
import eu.lmvi.socle.worker.gateway.AbstractGatewayWorker;
import okhttp3.OkHttpClient;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Component
public class WikidataGatewayWorker extends AbstractGatewayWorker {

    private final KewProperties props;
    private final ObjectProvider<EgressTunnelProxy> egress;
    private OkHttpClient httpClient;

    public WikidataGatewayWorker(KewProperties props, ObjectProvider<EgressTunnelProxy> egress) {
        this.props = props;
        this.egress = egress;
    }

    @Override
    public String getName() { return "wikidata_gateway"; }

    @Override
    protected void onInitialize() {
        int timeoutMs = props.getWikidata().getTimeoutMs();
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS);
        EgressTunnelProxy proxy = egress.getIfAvailable();
        if (proxy != null) builder.proxy(proxy.proxy());   // sinon : sortie directe, comme avant
        httpClient = builder.build();
        logger.info("[worker:{}][step:initialize] sortie={}", getName(),
            proxy == null ? "directe" : "mmh « " + proxy.stats().get("selector") + " »");
    }

    @Override
    protected void onStop() {
        if (httpClient != null) {
            httpClient.dispatcher().executorService().shutdown();
            httpClient.connectionPool().evictAll();   // rend les tunnels au Hub
        }
    }

    @Override
    public Map<String, Object> getStats() {
        Map<String, Object> stats = new HashMap<>(super.getStats());
        EgressTunnelProxy proxy = egress.getIfAvailable();
        stats.put("egress", proxy == null ? Map.of("enabled", false) : proxy.stats());
        return stats;
    }

    // … checkConnection(), appels protégés par executeProtected(), réglages RL/CB/Retry
}
```

Extrait fidèle de `APP-09-KEW/src/main/java/eu/lmvi/kew/service/WikidataGatewayWorker.java`
(les méthodes métier sont omises, le branchement est complet). `getIfAvailable()` est appelé dans
`onInitialize()`, quand le contexte est prêt — jamais dans le constructeur.

`proxy()` lève `IllegalStateException("proxy de sortie non démarré")` si le bean est fermé : ne
pas l'appeler après l'arrêt du contexte.

---

## 4. Étape 2 — `java.net.http.HttpClient`

```java
import eu.lmvi.socle.pack.egress.EgressTunnelProxy;

import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.http.HttpClient;
import java.time.Duration;

HttpClient viaEgress(EgressTunnelProxy egress) {
    return HttpClient.newBuilder()
        .proxy(ProxySelector.of((InetSocketAddress) egress.proxy().address()))
        .connectTimeout(Duration.ofSeconds(15))
        .build();
}
```

Aucun `Authenticator` : le proxy local ne demande pas d'identifiants, la clé IAM voyage dans la
métadonnée gRPC. Le réglage JVM `-Djdk.http.auth.tunneling.disabledSchemes=`, indispensable avec
`soclehub:3128`, est donc **inutile** avec le pack.

---

## 5. Étape 3 — Composant configuré par une URL de proxy (modèle RssArchiver)

Quand le client HTTP appartient à une autre bibliothèque qui ne lit qu'une URL, fixer le port
local : avec le défaut `0`, le port change à chaque démarrage et ne peut pas s'écrire en
configuration.

```yaml
socle:
  egress-client:
    enabled: ${SOCLE_EGRESS_CLIENT_ENABLED:false}
    endpoint: ${SOCLE_EGRESS_CLIENT_ENDPOINT:egress.thesocle.net:443}
    api-key: ${SOCLE_EGRESS_CLIENT_API_KEY:}
    selector: ${SOCLE_EGRESS_CLIENT_SELECTOR:pool}
    local-port: ${SOCLE_EGRESS_CLIENT_LOCAL_PORT:3129}
  ai:
    web:
      proxy-url: ${SOCLE_AI_WEB_PROXY_URL:}      # http://127.0.0.1:3129 pour sortir par les mmh
```

Activer les deux ensemble :

```bash
SOCLE_EGRESS_CLIENT_ENABLED=true
SOCLE_EGRESS_CLIENT_API_KEY=<clé IAM .net, tenant lmvi>
SOCLE_AI_WEB_PROXY_URL=http://127.0.0.1:3129
```

Le proxy écoute sur la boucle locale **du conteneur de l'app** : un conteneur voisin (Browserless,
Playwright, FlareSolverr chez RssArchiver) ne le voit pas et sort par l'IP de l'hôte.

---

## 6. Étape 4 — Autres protocoles TLS

Le pack relaie tout `CONNECT hôte:port` ; le Hub n'ouvre que les ports `80, 443, 465, 587, 993, 995`.
Un client SMTP de soumission (587/465) ou IMAPS (993) qui sait parler à un proxy HTTP `CONNECT`
peut donc passer par `127.0.0.1:<local-port>`. Le pack livre aussi au client les octets que le
serveur envoie **avant** le « 200 » (bannière `220` SMTP : test `livreApresLe200CeQueLeSiteDitEnPremier`).
Aucun consommateur ne s'en sert au 2026-10-28 : valider par un essai réel avant d'en dépendre.

---

## 7. Vérifier

```bash
# Depuis le conteneur de l'app, port fixe 3129 :
curl -s -x http://127.0.0.1:3129 https://api.ipify.org
# → l'IP du mmh choisi, ex. 152.228.141.0 pour mmh-prod-001

curl -s -o /dev/null -w '%{http_code}\n' -x http://127.0.0.1:3129 http://example.org/
# → 405 : le trafic en clair n'est pas relayé
```

Avec `local-port: 0`, lire le port dans le log de démarrage ou dans `stats().local_port`.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Appel HTTPS par le client branché | réponse du site ; `stats().tunnels_opened` augmente ; `last_exit_ip` = IP du mmh |
| 2 | Appel HTTPS par un client non branché | sortie directe ; compteurs du pack inchangés |
| 3 | `GET http://…` par le proxy | `405 Method Not Allowed`, aucun flux vers le Hub (test `refuseLeTraficEnClair`) |
| 4 | Fermer le client HTTP | `tunnels_active` revient à 0 ; le Hub reçoit `close` (test `relaieDansLesDeuxSens…`) |
| 5 | Le site ferme la connexion | la socket locale se ferme aussi (test `fermeLaConnexionLocaleQuandLeSiteFerme`) |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| URL `http://` vers le site | `405` du proxy | n'appeler que des URL `https://` par ce client ; garder un client direct pour le clair |
| `local-port: 0` et URL de proxy écrite en dur | connexion refusée sur `127.0.0.1:3129` | fixer `local-port` dès qu'une configuration cite l'URL |
| Conteneur voisin censé sortir par le proxy | il sort par l'IP de l'hôte | le proxy est lié à `127.0.0.1` du conteneur de l'app ; c'est voulu |
| Pool OkHttp qui garde 5 min des connexions vers de nombreux hôtes | `429 … 64 tunnels simultanés au plus par identité` | limiter le pool (`ConnectionPool(maxIdle, keepAlive)`), `evictAll()` à l'arrêt, une clé par instance |
| `egress.getObject()` au lieu de `getIfAvailable()` | l'app ne démarre plus quand `enabled=false` | `ObjectProvider.getIfAvailable()` et repli direct |
| Ajouter un `Authenticator` / `Proxy-Authorization` | inutile ; l'en-tête est lu puis ignoré par le pack | la clé est dans `socle.egress-client.api-key` |
| Tester avec `HTTP_PROXY`/`HTTPS_PROXY` globaux | tout le trafic, interne compris, tente le tunnel | brancher le proxy client par client |

---

## 10. Pour aller plus loin

- [[howto-egress-01-integrer-le-pack|EGRESS-01 — Intégrer le pack]]
- [[howto-egress-03-choisir-sa-sortie|EGRESS-03 — Choisir sa sortie]]
- [[howto-egress-04-observer-et-diagnostiquer|EGRESS-04 — Observer et diagnostiquer]]
- Templates de workers : `templates/workers/` (GatewayWorker : circuit breaker + retry inclus)
