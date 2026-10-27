---
id: UC-BUS-01
titre: "Stocker une valeur clé/valeur avec expiration"
theme: "UC-BUS · KvBus"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "kv_bus.set, get, delete, exists, scan, get_all, ttl_seconds"
---

# UC-BUS-01 — Stocker une valeur clé/valeur avec expiration

## Questions auxquelles répond ce cas d'usage
1. Où ranger une valeur de travail qu'un autre worker devra lire, sans créer de table ?
2. Comment faire expirer automatiquement une donnée au bout de cinq minutes ?
3. Cette valeur survit-elle au redémarrage de l'application ?
4. Comment retrouver toutes les clés d'un même préfixe ?
5. Quelle convention de nommage pour les clés, afin de ne pas se marcher dessus ?
6. Puis-je y mettre un objet complet, ou seulement du texte ?
7. Quand faut-il préférer la base technique à ce stockage ?

## Mots-clés
clé/valeur, key-value, cache, `kv_bus.set`, `kv_bus.get`, `delete`, `exists`, `scan`, `get_all`,
`ttl_seconds`, expiration, TTL, durée de vie, préfixe, mémoire, volatile, KvBus, verrou léger,
`setIfNotExists`

## Ce que c'est, et quand s'en servir
Le bus interne sert aussi de **tableau noir** : on y pose des valeurs sous une clé, avec ou sans
durée de vie, et tout worker de l'instance peut les lire. C'est l'endroit des données de travail —
dernier horodatage de traitement, résultat intermédiaire, jeton obtenu d'un tiers, compteur du jour.

Le préfixe sert de territoire : par convention, `<worker>:<sujet>` évite les collisions et rend le
contenu lisible en exploitation. Pour ce qui doit survivre au redémarrage ou être partagé entre
instances, c'est la base technique (UC-DB-01).

## Ce que le socle fait · ce qu'il interdit
Le socle fournit le stockage, applique l'expiration, et expose le même jeu d'opérations dans les
trois moteurs : lire, écrire, supprimer, tester l'existence, lister par préfixe. Le contenu est
**local à l'instance et volatile**.

Il n'y a pas de transaction : deux écritures ne sont pas liées. Pour modifier une valeur en
fonction de son contenu actuel, on passe par les opérations atomiques (UC-BUS-02) — pas par
lecture-puis-écriture, qui perd des mises à jour.

## Exemples
### socle-py-django et socle-py
```python
self._kv_bus.set("collect_worker:last_success_ms", now_ms)
self._kv_bus.set("collect_worker:token", token, ttl_seconds=300)   # expire tout seul

token = self._kv_bus.get("collect_worker:token")                   # None si expiré ou absent
if not self._kv_bus.exists("collect_worker:lock"):
    ...
keys = self._kv_bus.scan("collect_worker:")                        # toutes les clés du préfixe
etat = self._kv_bus.get_all("collect_worker:")                      # clé → valeur
```

### Socle Java
```java
kvBus.set("collect_worker:token", token, 300);          // TTL en secondes
String token = kvBus.get("collect_worker:token", String.class);
Map<String, Object> etat = kvBus.getAll("collect_worker:");
```

### Observer en exploitation
Le Socle Java expose le contenu du bus sur une route d'administration (`/kv-data`, protégée par la
clé). Les moteurs Python ne portent pas cette route : on observe par les statistiques du worker ou
par une action de lecture qu'on déclare soi-même.
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/kv-data?prefix=collect_worker:   # Java
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers                     # partout
```

## Pièges courants
- **S'en servir comme d'une base** : aucune persistance, aucune réplication entre instances.
- **Clés sans préfixe** (`token`, `state`) : deux workers se marchent dessus, et personne ne sait à
  qui appartient la clé.
- **Stocker un objet mutable** et le modifier après l'avoir posé : déposer des valeurs immuables.
- **Oublier l'expiration sur un jeton** : on garde un secret périmé, et on ne comprend pas le 401.
- **Lire-modifier-écrire sans atomicité** : sous charge, des mises à jour disparaissent
  (UC-BUS-02).

## Cas d'usage voisins
- UC-BUS-02 — opérations atomiques
- UC-WRK-12 — partager un état entre workers
- UC-DB-01 — persister l'état technique
- UC-BUS-08 — changer d'implémentation de bus
