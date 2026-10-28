# HOWTO EGRESS-03 — Choisir sa sortie : sélecteur, affinité, pool du Hub

**Niveau :** Confirmé
**Cible :** app qui a intégré `socle-pack-egress` et doit maîtriser l'IP vue par le site appelé
**Versions vérifiées au code (2026-10-28) :** `socle-pack-egress` **2.0.0** (comportement identique à la 1.0.0, dernière version Boot 3) · Hub `soclehub` **3.73.0** (`EgressProxyServer`, `EgressTunnelGrpcService`, `MiniMiniHubDeployWorker`)
**Prérequis :** accès MCP au Hub `.net` (lecture du pool) ; clé IAM de l'app
**Temps estimé :** 15 min

---

## 1. Contexte

Le pack transmet au Hub, à chaque connexion, deux champs du message `OpenRequest` :
`selector` (propriété `socle.egress-client.selector`) et `affinity` (`socle.egress-client.affinity`).
Le **Hub** décide de la sortie ; le pack se contente de les envoyer, et remonte dans ses compteurs
la sortie retenue (`last_exit`) et son IP (`last_exit_ip`).

Le sélecteur est **unique pour tout le bean** : une instance d'app = une politique de sortie.
KEW en tire parti : chaque instance a **sa** sortie fixe, donc son IP et son quota Wikidata.

---

## 2. Architecture

```
socle.egress-client.selector = "pool-FR"     affinity = "parcours9"
                │                                   │
                ▼                                   ▼
OpenRequest{host, port, selector:"pool-FR", affinity:"parcours9"}
                │
                ▼  Hub — EgressTunnelGrpcService
selector + "~" + affinity  ──►  "pool-FR~parcours9"
                │
                ▼  EgressProxyServer.openForClient → resolve(sel, principal)
   pool du Hub : mmh de rôle « proxy », HEALTHY, vus il y a < 15 s, non exclus par la sonde
                │
                ▼
OpenAck{ok, code, exit:"mmh-nuc-004", ip:"176.185.174.223", tor:false}
                │
                ▼  pack — stats() : last_exit, last_exit_ip
```

---

## 3. Étape 1 — La grammaire du sélecteur

`<base>[+tor][~<jeton>]`, appliquée par le Hub (`EgressProxyProtocol.selector`) :

| Sélecteur | Sortie | Usage |
|---|---|---|
| `pool` (défaut ; vide = `pool`) | la sortie portant le moins de tunnels, à tour de rôle entre ex æquo | répartir sans contrainte d'IP |
| `pool-FR`, `pool-US`, `pool-SG` | idem, restreint à un pays (ISO 2 lettres) | contrainte géographique |
| `mmh-prod-001` (slug) ou l'UUID `miniminihub_id` | cette sortie précise, IP fixe | quota par IP, liste blanche chez le fournisseur |
| `…+tor` | par le Tor de ce mmh (`mmh-prod-001+tor`, `pool+tor`) | anonymisation ; IP changeante |
| `…~<jeton>` | même sortie pour toutes les connexions qui portent ce jeton, TTL `socle.egress.proxy.sticky-ttl-ms` (défaut 600 000 ms) | session côté site |

`socle.egress-client.affinity: parcours9` équivaut à écrire `~parcours9` dans le sélecteur ; le
Hub ne l'ajoute que si le sélecteur ne contient pas déjà `~`.

---

## 4. Étape 2 — Lire le pool (côté Hub)

Le pack n'a pas d'équivalent au `GET /pool` de `soclehub:3128`. On consulte le pool par MCP sur le
Hub `.net` :

`miniminihub_deploy_worker__egress_pool` — paramètres `usable_only` (défaut `true`) et `role`
(défaut `proxy`, vide = tous) :

```json
{ "usable_only": true, "role": "proxy" }
```

Extrait du relevé du 2026-10-28 (11 sorties utilisables) :

| slug | IP de sortie | pays | FAI |
|---|---|---|---|
| `mmh-prod-001` | 152.228.141.0 | FR | OVH SAS |
| `mmh-prod-002` | 152.228.143.218 | FR | OVH SAS |
| `mmh-nyc-001` | 107.170.16.49 | US | DigitalOcean |
| `mmh-saf-001` | 138.68.240.16 | US | DigitalOcean |
| `mmh-sin-001` | 152.42.232.247 | SG | DigitalOcean |
| `mmh-nuc-004` | 176.185.174.223 | FR | Bouygues Telecom |
| `mmh-nuc-005` | 109.220.92.114 | FR | Orange |
| `mmh-nuc-007` | 89.90.24.53 | FR | Bouygues Telecom |
| `mmh-nuc-001`, `mmh-nuc-006`, `mmh-nuc-012` | **82.67.1.235** (les trois) | FR | Free |

`egress_proxy_worker__egress_proxy_status` donne la même liste vue par le moteur de sortie, avec
`active_tunnels` par sortie et les garde-fous (`allowed_ports`, `allowed_tenants`,
`max_tunnels_per_key`, `host_limits`).

---

## 5. Étape 3 — Tester une sortie avant de la configurer

`miniminihub_deploy_worker__egress_test` fait sortir un `GET` en clair (HTTP/1.0) par un mmh et rend
le corps :

```json
{ "miniminihub_id": "0d39d6ee-72be-49d0-a36f-74f1b559b462", "host": "api.ipify.org", "port": 80, "path": "/" }
```

Le corps rendu est l'IP de sortie (`152.228.141.0`). `via_tor: true` teste la voie Tor du même mmh.
Ce test emprunte le chemin Hub → mini-hub → mmh, sans le pack ni la clé de l'app.

---

## 6. Étape 4 — Configurer la politique

**Une IP fixe par instance** (KEW, décision du 2026-09-26) :

```yaml
# mini001
socle.egress-client.selector: mmh-prod-001
# spark
socle.egress-client.selector: mmh-prod-002
# mini-m4
socle.egress-client.selector: mmh-nyc-001
```

**Rotation dans un pays, avec session collante :**

```yaml
socle:
  egress-client:
    enabled: true
    api-key: ${MON_APP_EGRESS_API_KEY}
    selector: pool-FR
    affinity: ${HOSTNAME}        # chaque réplique garde sa sortie pendant 10 min
```

Pour plusieurs politiques dans une même app (deux IP fixes, par exemple), le pack (1.0.0 comme 2.0.0) n'offre
qu'un bean : la voie est un second `EgressTunnelProxy` construit à la main avec ses propres
`EgressClientProperties`, démarré par `start()` et fermé par `close()`.

```java
import eu.lmvi.socle.pack.egress.EgressClientProperties;
import eu.lmvi.socle.pack.egress.EgressTunnelProxy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;

@Configuration
public class SecondeSortieConfig {

    @Bean(destroyMethod = "close")
    public EgressTunnelProxy sortieNyc(@Value("${socle.egress-client.api-key}") String apiKey) throws IOException {
        EgressClientProperties p = new EgressClientProperties();
        p.setApiKey(apiKey);
        p.setSelector("mmh-nyc-001");
        EgressTunnelProxy proxy = new EgressTunnelProxy(p);
        proxy.start();
        return proxy;
    }
}
```

L'auto-configuration ne porte pas de `@ConditionalOnMissingBean` : les deux beans coexistent. Un
`ObjectProvider<EgressTunnelProxy>.getIfAvailable()` non qualifié lève alors
`NoUniqueBeanDefinitionException` ; chaque injection doit qualifier son bean
(`@Qualifier("egressTunnelProxy")` pour celui du pack, `@Qualifier("sortieNyc")`). Les deux
partagent le plafond de 64 tunnels de la clé.

---

## 7. Vérifier

```bash
# depuis le conteneur de l'app (port fixe) :
curl -s -x http://127.0.0.1:3129 https://api.ipify.org     # → IP attendue de la sortie
```

Dans le `getStats()` du worker (si `proxy.stats()` y est exposé, cf. [[howto-egress-04-observer-et-diagnostiquer|EGRESS-04]]) :
`last_exit` = slug retenu, `last_exit_ip` = IP. Avec `pool`, ces valeurs changent d'une connexion
à l'autre.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `selector: mmh-prod-001` | `last_exit = mmh-prod-001`, `last_exit_ip = 152.228.141.0` |
| 2 | `selector: pool-XX` (pays sans sortie) | `503 aucune sortie utilisable pour « pool-XX »` |
| 3 | `selector: pool`, `affinity: a1`, 3 connexions en < 10 min | même `last_exit` aux trois |
| 4 | slug d'un mmh éteint | `503` ; revenir sur `pool` ou un autre slug |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Croire qu'un slug = une IP unique | `mmh-nuc-001`, `-006`, `-012` sortent tous par `82.67.1.235` : même quota chez le site | lire `egress_ip` dans `egress_pool` avant de répartir ; pour un quota par IP, viser une IP **distincte** (VPS distant) |
| Lire `tor: true` / `tor_selectable` comme « le trafic passe par Tor » | inquiétude infondée | c'est la capacité d'accepter `+tor` ; sans suffixe, la sortie est l'IP normale du mmh |
| Réserver une IP « sous cloche » | refus d'y faire passer un autre flux | la réservation porte sur le couple IP ↔ **cible** : un flux vers un autre site n'est pas corrélé |
| mmh posé par jeton (clé USB) absent du pool | `503` sur son slug alors qu'`egress_test` le prouve | son registre a `roles = '{}'` ; corrigé en Hub 3.72.3 + minihub 1.6.14 — vérifier `egress_pool(role="", usable_only=false)` |
| Multiplier les IP pour dépasser une limite de débit | blocage de plages entières par le fournisseur | respecter les `429` du site ; le Hub peut poser `host-limits` |
| `+tor` pour un service qui exige une IP stable | sessions invalidées, captchas | slug fixe sans `+tor` |
| Sélecteur différent par appel | impossible avec le bean unique | un `EgressTunnelProxy` par politique (§6) |

---

## 10. Pour aller plus loin

- [[howto-egress-01-integrer-le-pack|EGRESS-01 — Intégrer le pack]]
- [[howto-egress-02-faire-sortir-un-client-http|EGRESS-02 — Faire sortir un client HTTP]]
- [[howto-egress-04-observer-et-diagnostiquer|EGRESS-04 — Observer et diagnostiquer]]
- `soclehub/docs/HOWTO-SORTIR-PAR-LES-MMH.md` §2, §7 ter (sélecteur et affinité côté proxy `soclehub:3128`)
