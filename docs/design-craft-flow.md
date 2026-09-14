# Design source — NEYA Craft Flow (Lovable)

**Preview :** https://neya-craft-flow.lovable.app  
**Repo (public) :** https://github.com/neyafurniture-lang/neya-craft-flow  

Référence visuelle officielle pour **toute** l’app ERP.

## Portage (état)

| Zone | Statut |
|------|--------|
| Tokens / typo / shell / login | Fait + polish pro motion (2026-09) |
| Motion system | `.neya-enter` / `.neya-stagger` / `.neya-lift` / reduced-motion |
| Dashboard | Fait (composition Craft Flow + animations entrée) |
| Calendrier | Fait (grille mois Craft Flow + vue équipe) |
| Clients | Fait (table Craft Flow : projets, total, statut, dernier contact) |
| Projets / Production | Fait |
| Factures / Dépenses / Stock / Achats | Fait |
| Settings / Admin / Sauna / Web / Drive / Roadmap / Manuel | Fait |
| Courriel | Fait (parity Lovable : flush 3–4 col, chips, preview, compose card ; APIs Gmail inchangées) |
| Plans de coupe | Shell aligné |

## Direction UX pro (réfs Pinterest / SaaS)

- Composition bento / panneaux clairs, ombres douces (`--shadow-soft` / `--shadow-lift`)
- Accent orange NEYA uniquement (pas de violet « AI »)
- Micro-interactions : boutons lift, KPI hover, barres de progression animées
- Typo Urbanist + Epilogue (déjà Craft Flow) — pas Inter/Roboto
- Respect `prefers-reduced-motion`

## Fichiers clés

- `frontend/app/globals.css` — tokens + `.cf-chip` / `.cf-table-wrap` / mail
- `frontend/components/{AppShell,Sidebar,MobileNav,NeyaMark}.js`
- Pages sous `frontend/app/**/page.js`
