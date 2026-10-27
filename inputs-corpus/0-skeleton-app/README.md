<!-- KIT-VERSION: 1.11.0 -->
# Slot 0 · Skeleton d'app (APP-ZZ-TEMPLATE)

- **Source canonique** : `/opt/2026-TheHub4TheSocle/APP-ZZ-TEMPLATE/` (`bootstrap.sh` + docs)
- **Ce que l'app y prend** : le **squelette de départ** qui fournit la plomberie transversale —
  **connexion DB** (datasource + creds injectés Hub), **auth/SSO** (`SsoAuthFilter` + `MeController`,
  en-têtes `X-SSO-*` du proxy), **rôles/scopes/tenant** (`manifest.json` iam + `x_partition`),
  `Dockerfile`, `Application.java`, SPA forwarding.
- **Instancier** : `./bootstrap.sh <app> [--with-frontend]` → on hérite de tout ça, on ne le recode pas.
- **Les deux catalogues qu'il porte** (kit 1.11.0), consultés en M6 pour router chaque brique :
  - `docs/services-disponibles/` — **43 guides** des services du Hub : *quel service je consomme
    au lieu de le recoder ?*
  - `docs/use-cases/` — **148 fiches** de mécanismes du socle : *par quel mécanisme je l'écris
    dans mon code ?*

> C'est le slot **0** car c'est le **préalable** : on part de ce squelette, puis on remplit les slots 1→8.
