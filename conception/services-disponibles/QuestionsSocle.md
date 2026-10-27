---
document: QUESTIONS-HUB
version: 0.1.0
date: 2026-04-29
destinataire: Mainteneur SocleHub (wp.team)
émetteur: Jean-Marc HENRY
projet: ApplicationEditors v1.0.0
---

# Questions à SocleHub pour intégration ApplicationEditors

## Contexte

Nous développons **ApplicationEditors**, une application web unique qui permet à un utilisateur authentifié sur SocleHub d'éditer les fichiers du Repository V005 de **n'importe quelle Socle** à laquelle il a accès.

L'application a :
- Un **frontend React** (login + éditeur Monaco multi-types)
- Un **backend Spring Boot** qui proxifie les appels vers les Socles cibles

Pour câbler l'intégration avec SocleHub, nous avons besoin des informations précises ci-dessous. **Merci de répondre Q par Q avec des valeurs concrètes** (URL exactes, JSON exemples, headers HTTP). Si une fonctionnalité n'existe pas encore, indique-le clairement (plutôt que d'inventer un comportement) — on adaptera le périmètre.

---

## 1. Authentification utilisateur

### Q-AUTH.1 — URL de login
Quel est l'URL **exact** de l'endpoint de login ?

> Exemple attendu : `POST https://hub.thesocle.net/wp-json/lmvi/v1/iam/login`

**Réponse** :

---

### Q-AUTH.2 — Body de la requête de login
Quel **body** est attendu en POST ?

> Options possibles :
> ```json
> { "email": "...", "password": "..." }
> ```
> ou
> ```json
> { "username": "...", "password": "..." }
> ```
> ou autre format ?

**Réponse** :

---

### Q-AUTH.3 — Format de la réponse de login
Quel **format de réponse** ?

- [ ] JWT dans le body : `{ "token": "eyJ..." }`
- [ ] Cookie de session HTTP-only
- [ ] Autre format (préciser)

**Réponse** :

---

### Q-AUTH.4 — Algorithme de signature JWT
Si la réponse est un JWT : quel **algorithme de signature** ?

- [ ] `HS256` (secret partagé) → comment nous transmets-tu le secret ?
- [ ] `RS256` (clé publique) → la clé publique est où ?
  - [ ] Endpoint JWKS : URL ?
  - [ ] Fichier statique : URL ?
  - [ ] Variable d'environnement à provisionner
  - [ ] DNS TXT (record name ?)
- [ ] `ES256`
- [ ] Autre

**Réponse** :

---

### Q-AUTH.5 — Claims du JWT
Peux-tu nous montrer un **exemple de JWT décodé** (le payload JSON) ?

On a besoin de savoir :
- Le claim qui identifie l'user (`sub` ? `email` ? `user_id` ?)
- Le claim d'expiration (`exp`)
- Si la liste des Socles est embarquée dedans, ou s'il faut un appel séparé

**Réponse** :
```json
{
  ...
}
```

---

### Q-AUTH.6 — TTL et refresh
- **TTL** du token (en secondes ou heures) ?
- **Refresh token** disponible ? Si oui : endpoint et flow ?
- Sinon : re-login après expiration ?

**Réponse** :

---

### Q-AUTH.7 — Header HTTP d'authentification
Quel **header HTTP** est attendu sur les requêtes authentifiées vers le HUB ?

- [ ] `Authorization: Bearer <token>`
- [ ] `X-LMVI-Token: <token>`
- [ ] Cookie automatique
- [ ] Autre

**Réponse** :

---

### Q-AUTH.8 — Endpoint logout
Existe-t-il un endpoint **logout / invalidation de token** ?

> Exemple attendu : `POST /wp-json/lmvi/v1/iam/logout`

**Réponse** :

---

### Q-AUTH.9 — CORS
Le HUB autorise quels **Origin** en cross-domain ?  
On a besoin que l'URL où sera hébergé ApplicationEditors soit autorisée (URL définitive à confirmer, ex : `editor.thesocle.net`).

**Réponse** :

---

## 2. Liste des Socles d'un utilisateur

### Q-SOCLES.1 — Endpoint
Quel endpoint retourne la liste des Socles auxquelles l'user authentifié a accès ?

> Exemple attendu : `GET /wp-json/lmvi/v1/iam/me/socles`

**Réponse** :

---

### Q-SOCLES.2 — Format de la réponse
Peux-tu nous montrer un **exemple de réponse JSON** ?

On attend, par Socle, au minimum :
- `id` (identifiant unique stable)
- `label` (nom affichable)
- `url` (URL réseau pour appeler l'API repository de cette Socle)

Et idéalement :
- les droits (lecture seule / lecture-écriture / etc.)
- la version Socle
- l'environnement (prod/staging/dev)

**Réponse** :
```json
{
  ...
}
```

---

### Q-SOCLES.3 — Pagination
Le résultat est-il **paginé** ? Un user peut-il avoir 50+ Socles ?

**Réponse** :

---

## 3. Authentification ApplicationEditors → Socle cible

C'est le point le plus important. Quand ApplicationEditors appelle `/api/repository/...` sur une Socle cible, il doit s'authentifier d'une manière acceptée par cette Socle.

### Q-PROXY.1 — Mécanisme d'authentification
**Laquelle des trois options est en place (ou à mettre en place) ?**

- [ ] **(a) Federation** : le JWT du user (émis par le HUB) est accepté tel quel par les Socles cibles ; chaque Socle valide le JWT avec la clé publique du HUB.
- [ ] **(b) Bridge keys** : chaque Socle a une clé d'API spécifique connue d'ApplicationEditors (stockée en config locale).
- [ ] **(c) Token court délégué** : le HUB délivre à la demande un token spécifique à une Socle, ex :
  ```
  POST /wp-json/lmvi/v1/iam/socle-token
  Body: { "socle_id": "appdemo-prod" }
  Réponse: { "token": "...", "expiresAt": "..." }
  ```

**Réponse** :

---

### Q-PROXY.2 — Si option (b) bridge keys
Où sont stockées les bridge keys aujourd'hui ?
- [ ] Dans le HUB (BDD WP) → on les récupère comment ?
- [ ] Dans un coffre (Vault, etc.) → URL ?
- [ ] Provisionnées manuellement → format ?

**Réponse** :

---

### Q-PROXY.3 — Si option (c) token délégué
- L'endpoint `/iam/socle-token` (ou équivalent) **existe-t-il déjà** ?
- Si non : peut-il être ajouté côté HUB ? Délai ?

**Réponse** :

---

## 4. Droits granulaires

### Q-DROITS.1 — Granularité
Le HUB sait-il, pour un user, **quels types de fichiers** il peut éditer sur chaque Socle ?

> Exemple : "user X a write sur les `.jdm.json` mais read-only sur les `.java`"

- [ ] Oui (granularité fine par type de fichier)
- [ ] Oui mais seulement read/write global par Socle
- [ ] Non, accès Socle = binaire (oui/non)

**Réponse** :

---

### Q-DROITS.2 — Format
Si granularité existe : quel est le **format** de cette information dans la réponse `/me/socles` (ou ailleurs) ?

**Réponse** :
```json
{
  ...
}
```

---

## 5. Identité utilisateur côté Socle (audit)

### Q-AUDIT.1 — Header d'identité
Quand ApplicationEditors écrit sur la Socle cible, on veut **tracer qui** a fait la modification (pour le versioning maison + audit côté Socle).

Notre proposition : envoyer un header `X-Editor-User: jm@henry.sh` (ou autre nom) en plus du token d'authentification.

- La Socle V005 accepte-t-elle déjà ce header ?
- Sinon, quel header utiliser, ou faut-il le développer côté V005 ?

**Réponse** :

---

## 6. Liens vers la documentation existante

Si une partie des réponses est déjà documentée, merci de nous donner les **URLs** :

- Doc API SocleHub IAM : 
- Spec JWT (claims, signature) : 
- Doc Postman / OpenAPI : 
- Code source (repo + chemin) si pertinent : 

---

## Format de réponse souhaité

1. **Réponds Q par Q** dans ce même document (édite directement, ou copie en `QUESTIONS-HUB-REPLY.md`)
2. Pour les fonctionnalités qui **existent déjà** : valeurs concrètes (URL, JSON exemple, header)
3. Pour les fonctionnalités qui **n'existent pas encore** : marque "À développer" + estimation de délai
4. Pour les choix qui restent **à arbitrer ensemble** : marque "À discuter" + ta préférence

**Délai souhaité** : sous 5 jours ouvrés idéalement, pour ne pas bloquer le démarrage du projet ApplicationEditors.

**Contact** : Jean-Marc HENRY — jm@henry.sh

Merci !
