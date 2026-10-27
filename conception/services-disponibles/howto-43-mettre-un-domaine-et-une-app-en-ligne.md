---
id: HOWTO-43
titre: "Mettre un domaine et une app en ligne : registre des domaines et proxy"
theme: "NET · Réseau, domaines et mise en ligne"
surface: [domain_worker, proxy_worker, DomainService, DomainRepository, ProxyRoutingTable, ProxyRoute, DomainContextFilter, DynamicProxyFilter]
actions_mcp: 20
routes: ["/hub/domains", "/hub/proxy"]
etat_verifie:
  hub: "3.70.3"
  socle: "5.9.4"
  le: "2026-10-16"
  comment: "lu au code et mesuré sur admin.thesocle.net — 9 domaines, 65 hôtes, 77 routes"
voisins: [HOWTO-03, HOWTO-09, HOWTO-12, HOWTO-40]
---

# HOWTO 43 — Mettre un domaine et une app en ligne : registre des domaines et proxy

> **Niveau** : avancé | **Prérequis** : SocleHub Hub ≥ 3.70.1, accès admin, un domaine dont on contrôle la zone DNS, un jeton d'API du fournisseur DNS (Cloudflare, OVH, Infomaniak, Hostinger), ACME opérationnel | **Temps estimé** : 30 min hors propagation DNS

Ce guide montre comment **déclarer un domaine, y rattacher des hôtes, et router une app dessus** —
la chaîne par laquelle passe toute mise en ligne. Elle traverse **deux registres indépendants** que
rien ne réconcilie : le registre des domaines (11 actions, `domain_worker`) et la table de routage
du proxy (9 actions, `proxy_worker`). Confondre les deux, ou croire que l'un renseigne l'autre, est
la première cause d'hôte injoignable.

État mesuré sur `admin.thesocle.net` le **2026-10-16** (Hub 3.70.3) : **9 domaines**, **65 hôtes
déclarés**, **77 routes de proxy**. L'écart de 12 n'est pas une erreur — il est expliqué au
piège 1, et c'est le cœur de cette fiche.

---

## Questions auxquelles répond cette fiche

1. Quelle est la suite complète des gestes pour mettre une app en ligne sur un nouveau domaine ?
2. Pourquoi faut-il déclarer un hôte *et* créer une route — l'un ne suffit-il pas ?
3. Pourquoi ai-je 77 routes pour seulement 65 hôtes déclarés ?
4. Mon domaine est `ACTIVE` : est-ce qu'il est vérifié ?
5. Comment changer le port ou le mode SSO d'une app qui a plusieurs noms d'hôte ?
6. Pourquoi `update_route` a-t-il modifié une autre route que celle que je visais ?
7. Comment savoir si les serveurs derrière les routes répondent ?
8. Quel est le bon appel pour lister les routes de façon exploitable par un script ?
9. Quel jeton DNS le Hub emploie-t-il pour provisionner la zone d'un domaine de marque ?
10. Quels fournisseurs DNS sont pris en charge, et que signifie `external` ?
11. Que fait `tls_mode` et quand faut-il un certificat dédié ?
12. Quels sont les quatre modes de SSO, et où se règlent-ils ?
13. Mettre une app en ligne change-t-il sa protection contre les scans ?
14. Comment retirer proprement un domaine de marque et ses hôtes ?
15. À quoi sert le `canonical_host`, et que se passe-t-il s'il est vide ?

## Mots-clés

domaine, registre des domaines, `domain_register`, `verify_token`, preuve de propriété, TXT,
`domain_status`, `PENDING`, `VALIDATING`, `ACTIVE`, `SUSPENDED`, `RETIRED`, `verified`,
`kind`, `PRIMARY`, `BRAND`, `ALIAS`, `TECHNICAL`, `canonical_host`, `base_url`, `oidc_issuer`,
`cookie_domain`, marque, `brand_name`, `brand_color`, portail de marque, fournisseur DNS,
cloudflare, ovh, infomaniak, hostinger, `external`, `dns_zone_id`, jeton DNS par domaine,
`has_own_dns_token`, Vault, hôte, `domain_host_add`, `declared_host`, rôle d'hôte, `APP`, `PORTAL`,
`APIM`, `MAIL`, `tls_mode`, `WILDCARD`, `DEDICATED`, certificat joker, ACME,
table de routage, `add_route`, `update_route`, `remove_route`, `list_routes`, `get_routing_table`,
`app_id`, `target_host`, `target_port`, `proxy_protocol`, multi-route, multi-domaines,
`health_check_all`, `health_ok`, faux vert, stub, SSO, `enable_sso`, `sso_mode`, `none`, `gate`,
`optional`, `required`, `sso_scope`, cache de route, ScanGuard contourné, `DynamicProxyFilter`,
`DomainContextFilter`

---

## 1. Contexte — deux registres, pas un

| | Registre des domaines | Table de routage du proxy |
|---|---|---|
| **Worker** | `domain_worker` (11 actions) | `proxy_worker` (9 actions) |
| **Ce qu'il sait** | la marque : zone DNS, chemin Vault, cookie, émetteur OIDC, apparence du portail | l'aiguillage : `hostname` → `target_host:port`, TLS, SSO, cache |
| **Ce qu'il ignore** | vers quoi un hôte est routé | à quel domaine un hôte appartient |
| **Qui le consulte** | `DomainContextFilter` — étape 6 du plan de requête | `DynamicProxyFilter` — étape 7 |
| **Mesuré** | 9 domaines, 65 hôtes | 77 routes |

**Déclarer un hôte ne crée pas de route. Créer une route ne déclare pas l'hôte.** Les deux gestes
sont nécessaires, dans cet ordre, et aucun des deux ne prévient que l'autre manque.

Vérifiable en une commande :

```bash
mcp__soclehub__domain_worker__domain_resolve  hostname="thedash.thesocle.net"
```

```json
{"hostname":"thedash.thesocle.net","declared_host":false,"resolved":true,
 "domain_name":"thesocle.net","domain_kind":"PRIMARY","domain_status":"ACTIVE",
 "base_url":"https://admin.thesocle.net","cookie_domain":"thesocle.net","has_own_dns_token":false}
```

`thedash.thesocle.net` **sert en production** — c'est une des 77 routes — et pourtant
`declared_host: false`. Il est *résolu* par héritage du domaine parent, pas *déclaré*. C'est
tolérable pour un sous-domaine du domaine primaire ; ça ne l'est pas pour un domaine de marque, où
l'absence de déclaration prive l'hôte de son contexte de marque et d'émetteur OIDC.

---

## 2. Architecture — la chaîne de mise en ligne

**En une phrase, les neuf gestes et leur ordre.** On déclare le domaine
(`domain_register`), qui naît en `PENDING` avec un jeton de preuve à poser en TXT ; on pose les
enregistrements DNS ; on dépose le jeton d'API DNS **propre à ce domaine** sous sa racine Vault ; on
passe le statut à `ACTIVE` — **à la main, sans aucune vérification automatique** ; on règle
l'apparence du portail et son `canonical_host` ; on déclare **chaque hôte** servi sous ce domaine
avec son rôle et son mode TLS ; on obtient le certificat (le joker suffit si `tls_mode=WILDCARD`) ;
on crée la **route de proxy**, qui vit dans un registre entièrement différent du précédent ; et on
choisit le mode de SSO, par `app_id`. À l'exécution, deux filtres lisent ces deux registres :
`DomainContextFilter` en étape 6 du plan de requête, `DynamicProxyFilter` en étape 7. Le schéma
ci-dessous détaille cette chaîne.

```
  ① domain_register              le domaine naît en PENDING
     └─ un verify_token est émis : socle-verify-<32 hex>
                 │
  ② [DNS]        └─ poser l'enregistrement TXT de preuve
     │              puis le A/CNAME vers l'IP du Hub
     ▼
  ③ domain_set_dns_token         le jeton d'API DNS PROPRE au domaine,
     │                           sous sa racine Vault — pas celui du Hub
     ▼
  ④ domain_status → ACTIVE       ⚠️ geste MANUEL, aucune vérification
     │                              automatique (piège 2)
     ▼
  ⑤ domain_update                apparence du portail : nom affiché,
     │                           couleur, baseline, logo, canonical_host
     ▼
  ⑥ domain_host_add              déclarer CHAQUE hôte servi sous ce domaine
     │                           rôle : APP | PORTAL | API | APIM | MAIL |
     │                           CALENDAR | STORAGE | REGISTRY | MMH | OTHER
     │                           tls_mode : WILDCARD (défaut) | DEDICATED | NONE
     ▼
  ⑦ [ACME]                       le certificat — couvert par le *.<domaine>
     │                           si tls_mode=WILDCARD (cf. HOWTO 12)
     ▼
  ⑧ add_route                    l'aiguillage : hostname → target_host:port
     │                           ⚠️ registre DIFFÉRENT du ⑥ (piège 1)
     ▼
  ⑨ enable_sso                   le mode d'accès, par app_id
         none | gate | optional | required
```

Et à l'exécution, les deux filtres qui lisent ces registres, dans l'ordre :

```
  requête → ① HttpsRedirect → ② ScanGuard → ③ ApiAuth → ④ RequestId
          → ⑤ Apim → ⑥ DomainContext ← registre des domaines
          → ⑦ DynamicProxy  ← table de routage
          → ⑧ TenantContext (RLS) → ⑨ RateLimit → ⑩ OidcMcpAuth
```

> ⚠️ **Dès que l'hôte est dans la table de routage, le ScanGuard (étape ②) ne l'examine plus** — il
> laisse passer tout hôte routé, par conception. Mettre une app en ligne la **retire** de la
> protection contre les scans. Voir [[howto-40-scanguard-proteger-le-hub|HOWTO 40]], piège 1, où
> c'est mesuré.

### Les quatre natures de domaine

| `kind` | Sens | Remarque |
|---|---|---|
| `PRIMARY` | le domaine du Hub lui-même | **unique et déjà pris** — `thesocle.net` ici, 49 hôtes |
| `BRAND` (défaut) | un domaine de marque, avec son portail et son identité | les 8 autres |
| `ALIAS` | un nom qui retombe sur un autre | — |
| `TECHNICAL` | usage interne | — |

### Les cinq statuts

`PENDING` → `VALIDATING` → `ACTIVE` → `SUSPENDED` → `RETIRED`. Ils sont posés **à la main** par
`domain_status`. Rien ne les fait avancer tout seul — voir le piège 2.

---

## 3. Étape 1 — Déclarer le domaine

```bash
mcp__soclehub__domain_worker__domain_register \
  domain_name="exemple.fr" \
  kind="BRAND" \
  dns_provider="cloudflare" \
  dns_zone_id="86c02258f87077c6ca1921ba6fc16fbb" \
  canonical_host="portail.exemple.fr"
```

`domain_name` est **toujours** la racine, jamais un sous-domaine. Le domaine naît en `PENDING` avec un
`verify_token` de la forme `socle-verify-<32 hex>`, à poser en TXT dans la zone.

Les quatre fournisseurs DNS en production, mesurés : **cloudflare** (6 domaines), **infomaniak**
(2), **hostinger** (1). `ovh` et `external` sont également acceptés. `external` signifie « le Hub
ne touchera pas à cette zone » — tous les enregistrements sont alors à poser à la main.

```bash
# Le jeton d'API DNS propre à CE domaine, sous sa racine Vault
mcp__soclehub__domain_worker__domain_set_dns_token  domain_name="exemple.fr"  token="…"
```

C'est **ce jeton, et non celui du Hub**, qui servira à provisionner la zone. `domain_get` rend
`has_own_dns_token` : à `false`, le Hub retombe sur son propre jeton, qui n'a probablement pas les
droits sur cette zone.

```bash
mcp__soclehub__domain_worker__domain_status  domain_name="exemple.fr"  status="ACTIVE"
mcp__soclehub__domain_worker__domain_update \
  domain_name="exemple.fr"  canonical_host="portail.exemple.fr" \
  brand_name="Exemple"  brand_color="#863bff"  brand_tagline="Le portail d'Exemple" \
  brand_logo_url="https://…/logo.svg"
```

`canonical_host` **doit appartenir au domaine** — c'est lui qui devient `base_url` et
`oidc_issuer`. Un `canonical_host` vide donne `base_url = https://<domaine>` tout court, ce qui est
le cas de `lmvi-agent.fr` en production : son portail n'est pas désigné.

---

## 4. Étape 2 — Déclarer les hôtes

```bash
mcp__soclehub__domain_worker__domain_host_add \
  domain_name="exemple.fr"  hostname="compta.exemple.fr" \
  role="APP"  app_id="compta"  tls_mode="WILDCARD"
```

Le `role` n'est pas décoratif : il dit **ce que l'hôte sert**, et conditionne ce que les autres
dispositifs iront y chercher. `PORTAL` pour le portail de marque, `APIM` pour la passerelle d'API,
`MAIL` et `CALENDAR` pour James et Cosmo, `MMH` pour un miniMiniHub.

`tls_mode=WILDCARD` (défaut) signifie « couvert par le `*.<domaine>` » — rien de plus à faire si le
certificat joker existe. `DEDICATED` demande un certificat propre à cet hôte. `NONE` est pour un
hôte qui n'est pas servi en TLS par le Hub.

```bash
mcp__soclehub__domain_worker__domain_list     with_hosts="true"
mcp__soclehub__domain_worker__domain_get      domain_name="exemple.fr"
mcp__soclehub__domain_worker__domain_resolve  hostname="compta.exemple.fr"
mcp__soclehub__domain_worker__domain_host_remove  hostname="compta.exemple.fr"
```

`domain_resolve` est **l'outil de diagnostic à réflexe** : il dit à quel domaine un nom se rattache,
s'il est déclaré (`declared_host`), et avec quel contexte de marque. C'est la première commande à
lancer quand un hôte se comporte mal.

---

## 5. Étape 3 — Router l'app

```bash
mcp__soclehub__proxy_worker__add_route \
  app_id="compta"  hostname="compta.exemple.fr" \
  target_host="compta"  target_port="8080"
```

Les quatre paramètres sont **tous obligatoires**. `target_host` est le nom du conteneur sur le
réseau Docker, pas une IP.

```bash
mcp__soclehub__proxy_worker__list_routes          # 15 champs par route — la bonne lecture
mcp__soclehub__proxy_worker__get_routing_table    # ⚠️ inutilisable, voir piège 4
mcp__soclehub__proxy_worker__remove_route  hostname="compta.exemple.fr"
```

`list_routes` rend par route : `hostname`, `app_id`, `target_host`, `target_port`, `protocol`,
`proxy_protocol`, `tls_enabled`, `sso_enabled`, `sso_mode`, `sso_scope`, `sso_protected_paths`,
`cache_enabled`, `health_path`, `health_ok`, `status`.

État mesuré des 77 routes :

| Champ | Répartition |
|---|---|
| `status` | 77 `active` |
| `tls_enabled` | 77 `true` |
| `sso_mode` | 28 `required`, 28 `none`, 12 `gate`, 9 `optional` |
| `proxy_protocol` | 43 `http1.1`, 33 `auto`, 1 `http` |
| `cache_enabled` | 74 `false`, 3 `true` |
| `health_ok` | **77 `null`** ⚠️ piège 3 |

### Le SSO

```bash
mcp__soclehub__proxy_worker__enable_sso   app_id="compta"  sso_scope="app:compta"
mcp__soclehub__proxy_worker__disable_sso  app_id="compta"
```

Les quatre modes : `none` (aucun SSO), `gate` (le Hub authentifie puis laisse passer),
`optional` (l'identité est transmise si elle existe), `required` (accès refusé sans session).
La convention de scope en production est `app:<app_id>`.

`update_route` permet de régler finement — **mais lire le piège 1 avant de l'employer** :

```bash
mcp__soclehub__proxy_worker__update_route \
  app_id="compta"  sso_mode="required"  cache_enabled="true"  health_path="/health"
```

---

## 6. Validation

```bash
# 1. le domaine est actif et son portail est désigné
domain_get domain_name="exemple.fr"   → status ACTIVE, base_url, oidc_issuer, has_own_dns_token

# 2. l'hôte est DÉCLARÉ (et pas seulement résolu par héritage)
domain_resolve hostname="compta.exemple.fr"   → declared_host: true

# 3. la route existe, avec le bon SSO
list_routes | la ligne compta.exemple.fr   → target, sso_mode, status active

# 4. l'hôte répond vraiment, de l'extérieur
curl -sS -o /dev/null -w '%{http_code}\n' https://compta.exemple.fr/
```

**L'étape 4 n'est pas facultative**, et c'est la seule qui prouve quelque chose : les trois
premières ne lisent que des registres. Un hôte peut être déclaré, routé, actif — et injoignable
parce que le DNS pointe ailleurs ou que le certificat manque.

---

## 7. Pièges courants

### Piège 1 — 🔴 `update_route` se repère par `app_id`, et `hostname` n'est pas un sélecteur mais un champ à écrire

**Symptôme** : on appelle `update_route(app_id="appdemo", hostname="app.lmvi.ee", sso_mode="required")`
pour régler le SSO de cet hôte. Une autre route d'`appdemo` est modifiée, **et son nom d'hôte est
remplacé par `app.lmvi.ee`** — créant un doublon et rendant orpheline la route visée.

**Cause** : lue dans le code. `handleUpdateRoute` appelle `findRouteByAppId(appId)`, qui parcourt la
table et **rend la première route portant cet `app_id`** — dans l'ordre d'itération de la table, donc
indéterminé (`worker/ProxyWorker.java:953`). Puis `hostname`, s'il est fourni, est ajouté aux
clauses `SET` de l'`UPDATE` (`worker/ProxyWorker.java:754`). Il **renomme**, il ne sélectionne pas.

**Mesuré** : **12 des apps en production portent plusieurs routes.** Ce n'est pas un cas marginal,
c'est la conséquence normale du multi-domaines :

| `app_id` | Routes | Hôtes |
|---|--:|---|
| `appdemo` | **4** | `app.lmvi.ee`, `demo2.lmvi.link`, `appdemo.thesocle.net`, `app.lmvi.link` |
| `wpdiffuseur` | 3 | `www.thediffuseur.com`, `thediffuseur.com`, `wpdiffuseur.thesocle.net` |
| `thediffuseur` | 3 | `thediffuseur-link`, `thediffuseur`, `thediffuseur-status` (`.thesocle.net`) |
| `carousel`, `things`, `mandev`, `rssarchiver`, `sdr`, `uniqpersonnality`, `nginx-pub@…` | 2 chacune | … |

Pour `appdemo`, un `update_route` touche **une route sur quatre, sans dire laquelle**.

**Résolution** : sur une app mono-route, `update_route` est sûr. Sur une app multi-route,
**ne pas l'employer** : faire `remove_route(hostname=…)` puis `add_route(…)` avec les bonnes
valeurs — `remove_route` se repère bien par `hostname`. Et ne **jamais** passer `hostname` à
`update_route` sauf pour renommer délibérément. Vérifier avant tout appel :

```bash
mcp__soclehub__proxy_worker__list_routes   # compter les routes de cet app_id
```

### Piège 2 — `ACTIVE` ne veut pas dire « vérifié »

**Symptôme** : un domaine est `ACTIVE`, on le croit validé, et son portail rend des erreurs
d'émetteur OIDC ou de cookie.

**Cause** : `domain_status` est un **simple poseur de statut**. Il n'appelle aucune vérification :
il n'interroge pas le DNS, ne cherche pas le TXT de preuve, ne contrôle pas le certificat. Le champ
`verified` est distinct du statut, et il reste `false`.

**Mesuré** : sur les 9 domaines, **8 sont `verified: false`**, dont 7 en statut `ACTIVE`. Seul
`thesocle.net`, le domaine primaire, est `verified: true`. `app-15-crypto.com` est en `VALIDATING`
avec 3 hôtes déjà déclarés.

**Résolution** : lire `verified`, pas `status`. Et traiter `status` pour ce qu'il est — une intention
d'exploitation, pas un constat. Avant de déclarer un domaine `ACTIVE`, vérifier à la main le TXT de
preuve, le A/CNAME, et le certificat ; aucune de ces trois choses n'est contrôlée pour vous.

### Piège 3 — 🔴 `health_check_all` ne vérifie rien et répond « completed »

**Symptôme** : on lance `health_check_all` pour s'assurer que les 77 serveurs répondent. La réponse
est `{"status":"completed","checked":77}`. On conclut que tout va bien. `health_ok` reste `null`
partout.

**Cause** : **c'est un stub**, et le code le dit — `// Stub: log each route that would be checked`
(`worker/ProxyWorker.java:885`). La méthode parcourt les routes, **écrit une ligne de journal par
route**, et rend `completed` avec le nombre de routes parcourues. Aucune connexion n'est ouverte,
aucun `health_path` n'est appelé, rien n'est écrit en base.

**Mesuré** : `health_ok` vaut `null` sur **les 77 routes**, avant comme après l'appel. Le `checked:
77` compte des routes énumérées, pas des serveurs sondés.

**Résolution** : **ne pas se servir de cette action.** Pour savoir si un serveur répond, interroger
l'hôte de l'extérieur :

```bash
for h in $(…liste des hôtes…); do
  printf '%-40s ' "$h"; curl -sS -o /dev/null -w '%{http_code}\n' --max-time 5 "https://$h/"
done
```

Et considérer la colonne `health_ok` de `list_routes` comme non renseignée, jamais comme « sain ».
C'est un faux vert, c'est-à-dire le pire genre d'indicateur.

### Piège 4 — `get_routing_table` rend du `toString()` Java, sans `app_id`

**Symptôme** : on veut la table pour un script, et on reçoit des chaînes impossibles à analyser.

**Cause** : l'action sérialise chaque route par son `toString()` :

```json
{"routing_table":["ProxyRoute{hostname='thedash.thesocle.net', target=http://thedash:8080, tls=true, ssoMode='required', status='active'}", …],
 "size":77}
```

Cinq champs sur quinze, dans une chaîne, et **`app_id` n'y figure pas** — alors que c'est la clé
dont `update_route` a besoin.

**Résolution** : employer **`list_routes`**, qui rend 15 champs structurés par route. Réserver
`get_routing_table` à un coup d'œil humain.

### Piège 5 — Mettre un hôte en ligne le retire du ScanGuard

**Symptôme** : `/.env` et `/wp-login.php` sont bloqués sur le Hub, et passent sur l'app.

**Cause** : `BotnetScanFilter` laisse passer sans examen tout hôte présent dans la table de routage
(règle (b)). L'intention est que l'app gère son authentification ; l'effet est que la protection
contre les scans s'arrête à la frontière du proxy.

**Résolution** : c'est le comportement voulu, il n'y a rien à régler. Mais en tenir compte au moment
de la mise en ligne : si l'app est exposée publiquement et ne filtre pas, sa protection doit venir
de son APIM (avec un motif **en base**, cf. [[howto-40-scanguard-proteger-le-hub|HOWTO 40]] piège 3)
ou de son propre code. Mesuré sur trois hôtes routés dans le HOWTO 40.

### Piège 6 — Les 12 routes sans hôte déclaré

**Symptôme** : 77 routes pour 65 hôtes déclarés. On cherche l'erreur.

**Cause** : les deux registres sont indépendants (§1). Un `add_route` sans `domain_host_add`
produit une route qui fonctionne — l'aiguillage n'a pas besoin du registre des domaines — mais dont
l'hôte n'est **pas déclaré**. Il est alors seulement *résolu* par héritage du domaine parent, ce que
`domain_resolve` indique par `declared_host: false`.

**Résolution** : pour un sous-domaine du domaine primaire, l'héritage suffit en pratique. Pour un
domaine de marque, **non** : l'hôte non déclaré n'a ni son rôle, ni son `tls_mode`, et le contexte
de marque appliqué est celui du parent. Auditer régulièrement :

```bash
# les hôtes routés qui ne sont pas déclarés
mcp__soclehub__proxy_worker__list_routes          # les 77 hostname
mcp__soclehub__domain_worker__domain_list  with_hosts="true"   # les 65 déclarés
# puis, sur chaque écart : domain_resolve → declared_host
```

### Piège 7 — Le domaine primaire ne se supprime pas, et c'est heureux

**Symptôme** : `domain_remove domain_name="thesocle.net"` est refusé.

**Cause** : refus explicite — « le domaine primaire ne se supprime pas ». Il porte 49 des 65 hôtes
déclarés, le `base_url` du Hub et son émetteur OIDC.

**Résolution** : aucune, le garde-fou est correct. Pour retirer un domaine de marque, le passer en
`RETIRED` plutôt que de le supprimer : `domain_remove` emporte **ses hôtes avec lui**, et les routes
de proxy correspondantes, elles, **restent** — on obtient alors des routes orphelines, sans contexte
de domaine. Retirer les routes d'abord, le domaine ensuite.

---

## 8. Pour aller plus loin

- [[CATALOGUE-FONCTIONS-TSH|Catalogue des fonctions mutualisées]] — §7 réseau (42 actions) et §20 le plan de requête,
- [[howto-12-configurer-acme-cloudflare|HOWTO 12 — ACME / Cloudflare]] — le certificat joker qui rend `tls_mode=WILDCARD` possible,
- [[howto-40-scanguard-proteger-le-hub|HOWTO 40 — ScanGuard]] — pourquoi un hôte routé sort de la protection, mesuré,
- [[howto-09-configurer-sso-multi-app|HOWTO 09 — SSO multi-app]] — les quatre modes et le cookie de domaine,
- [[howto-03-installer-une-app|HOWTO 03 — Installer une app]] — l'installation crée la route ; cette fiche sert quand on la reprend à la main,
- `soclehub/src/main/java/eu/lmvi/soclehub/worker/ProxyWorker.java:741` — `handleUpdateRoute` et `findRouteByAppId`, les deux lignes du piège 1,
- `soclehub/src/main/java/eu/lmvi/soclehub/domain/service/DomainService.java` — statuts, natures, héritage de contexte.
