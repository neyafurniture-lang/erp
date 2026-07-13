/** Projet sur mesure = pas lié à une fiche catalogue */
export function isCustomProject(project) {
  return project != null && !project.standard_id;
}

export function checklistProgress(tasks = []) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
