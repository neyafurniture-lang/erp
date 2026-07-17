# Design source — NEYA Craft Flow (Lovable)

**Preview live :** https://neya-craft-flow.lovable.app  
**Repo GitHub (privé) :** https://github.com/neyafurniture-lang/neya-craft-flow  

Ce projet Lovable est la **référence visuelle** pour l’ERP (`neyafurniture-lang/erp`).  
Les tokens, typo et shell ont été portés dans `frontend/` pour coller à ce style.

## Tokens portés

| Élément | Valeur |
|--------|--------|
| Display | Urbanist |
| Body | Epilogue |
| Primary | `#D86B30` |
| Soft accent | `#FFEEE3` |
| Surface | `#FBFAF9` |
| Ink | `#0D0B09` |
| Radius | `0.75rem` (12px) |
| Sidebar actif | fond soft + barre verticale orange |

## Fichiers clés ERP

- `frontend/tailwind.config.js`
- `frontend/app/globals.css`
- `frontend/components/Sidebar.js`
- `frontend/components/AppShell.js`
- `frontend/app/login/page.js`

## Suite

1. Continuer page par page selon `docs/cahier-pages-lovable-une-par-une.md`
2. Quand Lovable livre un nouvel écran, le porter en gardant les APIs actuelles
3. Pour donner accès au repo GitHub privé aux agents : le rendre public ou inviter le token CI

## Accès

Le clone GitHub a échoué (404 / privé). Le portage s’est basé sur le **preview Lovable public** + CSS compilé (`/assets/styles-*.css`).
