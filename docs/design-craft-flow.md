# Design source — NEYA Craft Flow (Lovable)

**Preview :** https://neya-craft-flow.lovable.app  
**Repo (public) :** https://github.com/neyafurniture-lang/neya-craft-flow  

Référence visuelle officielle pour **toute** l’app ERP.

## Portage (état)

| Zone | Statut |
|------|--------|
| Tokens / typo / shell / login | Fait |
| Dashboard | Fait (composition Craft Flow : KPIs + Production + Agenda + Courriel) |
| Calendrier | Fait (grille mois Craft Flow + vue équipe) |
| Clients | Fait (table Craft Flow : projets, total, statut, dernier contact) |
| Projets / Production | Fait |
| Factures / Dépenses / Stock / Achats | Fait |
| Settings / Admin / Sauna / Web / Drive / Roadmap / Manuel | Fait |
| Courriel (CSS Craft Flow) | Fait (APIs Gmail inchangées) |
| Plans de coupe | Shell aligné |

## Fichiers clés

- `frontend/app/globals.css` — tokens + `.cf-chip` / `.cf-table-wrap` / mail
- `frontend/components/{AppShell,Sidebar,MobileNav,NeyaMark}.js`
- Pages sous `frontend/app/**/page.js`
