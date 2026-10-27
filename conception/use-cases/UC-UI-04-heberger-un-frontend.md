---
id: UC-UI-04
titre: "Héberger un frontend FrontendShell"
theme: "UC-UI · Pages et frontend"
moteurs:
  java: ok
  socle-py: P-5
  socle-py-django: P-5
contrat: "5.9"
mecanismes: "build statique, service à la racine, routes réservées, RG-26"
---

# UC-UI-04 — Héberger un frontend FrontendShell

## Questions auxquelles répond ce cas d'usage
1. Mon application peut-elle servir elle-même son interface web ?
2. À quelle adresse le frontend est-il servi, et qu'advient-il des routes du socle ?
3. Comment le frontend s'authentifie-t-il auprès des actions ?
4. Faut-il un serveur web séparé ?
5. Dans les moteurs Python, où en est cette possibilité ?
6. Comment éviter que le frontend masque les sondes de santé ?

## Mots-clés
frontend, FrontendShell, build statique, hébergement, racine, routes réservées,
`/health`, `/api`, `/dashboard`, authentification, jeton délégué, RG-26,
serveur séparé, P-5, cache, versions

## Ce que c'est, et quand s'en servir
Servir un frontend construit (des fichiers statiques) directement depuis l'application, à la racine
du domaine, pendant que les routes du socle restent accessibles. L'intérêt est le déploiement
unique : une image, un conteneur, une adresse.

## Ce que le socle fait · ce qu'il interdit
Java : l'hébergement est pris en charge, avec les routes du framework préservées. Moteurs Python :
phase **P-5**.

La règle qui compte : le frontend **ne doit pas masquer** les routes du socle — sondes de santé,
surfaces d'administration, points de publication. Une règle de service trop gourmande qui renvoie la
page d'accueil pour tout chemin inconnu casse les sondes, et l'infrastructure croit l'instance morte.

Côté authentification, rien de spécial : le frontend porte le jeton délégué de l'utilisateur
(UC-SEC-04) et appelle les actions. Jamais une clé d'administration dans du code livré au
navigateur.

## Exemples
### En attendant P-5 — un serveur statique séparé
```yaml
# docker-compose.yml : le frontend est servi à côté, la Gateway route.
services:
  app:      {image: mon-app:1.0.0}
  frontend: {image: nginx:alpine, volumes: ["./frontend/dist:/usr/share/nginx/html:ro"]}
```

### Le frontend appelle les actions
```javascript
await fetch("/admin/workers/orders_worker/actions/list_orders", {
  method: "POST",
  headers: {"Authorization": `Bearer ${jeton}`, "Content-Type": "application/json"},
  body: "{}"
});
```

### Vérifier que rien n'est masqué
```bash
for p in / /health /health/ready /admin/workers; do
  printf '%-18s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' localhost:8080$p)"
done
```

Moteurs Python : l'hébergement d'un frontend construit **à la racine** reste à faire (P-5). En
revanche, le service de **fichiers statiques** est livré avec les pages (UC-OPS-07) :
``socle.python.pages.static-dirs`` sont servis sous ``/static``, confinés à ces dossiers (un chemin
qui remonte ou un lien qui sort est refusé). Cela suffit aux ressources d'une application — CSS, JS,
images, polices —, pas à servir une application web complète ni de gros médias.

## Pièges courants
- **Une règle de repli trop large** : la page d'accueil répond sur `/health`, et les sondes
  échouent.
- **Une clé d'administration dans le frontend** : elle est publique.
- **Pas de gestion de version des fichiers** : les navigateurs servent un ancien frontend depuis
  leur cache.
- **Mélanger le cycle de vie du frontend et du backend** sans le vouloir : une correction d'interface
  impose un redéploiement de l'application.

## Cas d'usage voisins
- UC-UI-06 — rendre une page avec un moteur de gabarits
- UC-SEC-04 — accepter un JWT délégué sur les actions REST
- UC-SUP-01 — répondre aux sondes de santé
- UC-INT-05 — servir gRPC-Web à un frontend
